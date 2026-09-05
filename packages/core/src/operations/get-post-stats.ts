// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
} from "../services/errors.js";
import type { PostStats } from "../types/post-analytics.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import {
  capturePostDetailExtractionFailure,
  waitForPostLoad,
} from "../cdp/wait-for-post-load.js";
import {
  adaptersFor,
  buildPostDetailExtractionSource,
  variantNamesFor,
} from "../linkedin/dom-variant.js";
import { gaussianDelay } from "../utils/delay.js";
import type { ConnectionOptions } from "./types.js";
import { navigateAwayIf } from "./navigate-away.js";

/**
 * Input for the get-post-stats operation.
 */
export interface GetPostStatsInput extends ConnectionOptions {
  /** LinkedIn post URL or raw URN (e.g. `urn:li:activity:1234567890`). */
  readonly postUrl: string;
}

/**
 * Output from the get-post-stats operation.
 */
export interface GetPostStatsOutput {
  readonly stats: PostStats;
}

/**
 * Extract a post activity URN from a LinkedIn post URL or raw URN.
 *
 * Supported formats:
 * - `https://www.linkedin.com/feed/update/urn:li:activity:XXXXX/`
 * - `https://www.linkedin.com/feed/update/urn:li:ugcPost:XXXXX/`
 * - `https://www.linkedin.com/feed/update/urn:li:share:XXXXX/`
 * - `https://www.linkedin.com/posts/username_activity-XXXXX-xxxx/`
 * - Raw URN: `urn:li:activity:XXXXX`
 */
export function extractPostUrn(input: string): string {
  // Handle /feed/update/ URLs containing a URN path segment
  const updateMatch = /\/feed\/update\/(urn:li:\w+:\d+)/.exec(input);
  if (updateMatch?.[1]) return updateMatch[1];

  // Handle /posts/ URLs that embed the activity ID in the slug
  const postsMatch = /\/posts\/[^/]+_activity-(\d+)/.exec(input);
  if (postsMatch?.[1]) return `urn:li:activity:${postsMatch[1]}`;

  // Handle raw URN input
  if (/^urn:li:\w+:\d+$/.test(input)) return input;

  throw new Error(`Cannot extract post URN from: ${input}`);
}

/**
 * Resolve a post URL or URN into a navigable LinkedIn post detail URL.
 * Accepts full LinkedIn URLs (returned as-is) or raw URNs (converted to URL).
 */
export function resolvePostDetailUrl(input: string): string {
  if (input.startsWith("https://")) return input;
  if (input.startsWith("urn:li:")) return `https://www.linkedin.com/feed/update/${input}/`;
  throw new Error(`Invalid post identifier: ${input}`);
}

// ---------------------------------------------------------------------------
// Raw shapes returned by the in-page scraping script
// ---------------------------------------------------------------------------

/**
 * The subset of the post-detail extraction record this operation reads.
 *
 * The script returns the whole record — author, text, timestamp and the three
 * counters.  Only the counters are named here, because only they are read:
 * declaring the rest would advertise fields this operation neither uses nor
 * grades.
 */
interface RawPostStats {
  reactionCount: number;
  commentCount: number;
  shareCount: number;
}

/**
 * Two or more adapters claimed the page — a transitional or hybrid dialect.
 * Reported rather than resolved, for the reason `get-post` reports it:
 * counters assembled out of two dialects are wrong in a way nothing
 * downstream can detect.
 */
interface AmbiguousPostStats {
  ambiguousVariants: string[];
}

function isAmbiguous(
  raw: RawPostStats | AmbiguousPostStats,
): raw is AmbiguousPostStats {
  return Array.isArray((raw as AmbiguousPostStats).ambiguousVariants);
}

// ---------------------------------------------------------------------------
// In-page DOM scraping script
// ---------------------------------------------------------------------------

/** The page kind this operation reads; picks the adapter list it binds to. */
const POST_DETAIL_SURFACE = "post-detail" as const;

/**
 * JavaScript source evaluated inside the LinkedIn post detail page to
 * extract engagement statistics from the rendered DOM.
 *
 * This is the SAME generated script `get-post` evaluates, and that identity is
 * the fix rather than an economy (#857).  What it replaces was a hand-written
 * regex sweep over `document.body.textContent`, byte-identical to the parse
 * `#824` / `#836` had already removed from the post-detail path — the same
 * code against the same flattened page, so it returned the same wrong numbers.
 * Three independent ways, none of them visible in the number that comes back:
 *
 * - **The join.**  Under `textContent` adjacent element text nodes concatenate
 *   with NO separator, so a counts row rendering `2` beside `41 comments`
 *   flattens to `241 comments` and the comment pattern captures 241.  Measured
 *   live on the `get-post` path: LinkedHelper 2.130.29, a 589 KB post-detail
 *   page whose true comment count was 41.
 * - **The label.**  LinkedIn renders a reaction count as a bare number and puts
 *   the words only on the control's `aria-label` — "2", labelled
 *   "2 reactions".  A text-only read finds no reaction count at all, so
 *   inserting a separator would have fixed only the first half.
 * - **The scope.**  With no scope, the first `"<N> comments"`-shaped run
 *   ANYWHERE in the document wins: page chrome, a sibling module, a comment's
 *   own counter, or the post's prose.
 *
 * Reusing the post-detail builder rather than growing a counts-only one is
 * deliberate.  A second builder would need its own copy of adapter selection
 * and scope resolution, and `dom-variant.ts` is explicit throughout that
 * hand-maintained copies of a rule drift apart — its two copies of the
 * headline rule already had, with neither a superset of the other.  One script
 * means one selection, one scope cascade, and one already-graded set of
 * integration assertions covering the join, the label and the scope
 * (`dom-variant.integration.test.ts`).  The cost is the field extraction this
 * operation discards, which is a handful of in-page `querySelector` calls on a
 * page it has just navigated to.
 *
 * ## What this does NOT settle
 *
 * The readiness gate is untouched — `waitForPostLoad` still polls the selected
 * post-detail adapter's own anchor — and #852, the seam between that gate and
 * this extraction, stays open.  Both of its directions are worth naming,
 * because binding the parse moved one of them and not the other:
 *
 * - **False readiness** survives unchanged.  A green gate says nothing about
 *   whether the counts region rendered, and where no element renders a counter
 *   the read still returns 0 rather than refusing.
 * - **False refusal** is now enforced here as well as at the gate.  The
 *   extraction resolves adapters itself, so a page no post-detail adapter
 *   claims raises instead of yielding whatever a whole-page regex found.  That
 *   narrows #852's remedy space rather than deciding it: relaxing the gate
 *   ALONE would no longer let counts through from such a page, because this
 *   read refuses independently.  Which remedy #852 takes is still its call.
 *
 * One behaviour delta the trade carries, recorded because it is not free.  The
 * old read was loose over the whole body; this one is strict per element, with
 * the loose fallback gated on a counts root the adapter itself declared.  The
 * `legacy` adapter declares one, so a row rendering both counters as a single
 * node still yields 41.  The `sdui` adapter declares `counts: []` — its counts
 * row has never been measured — so there the root is the post container,
 * `narrowed` is false, and such a row now yields 0 where the loose whole-page
 * read returned 41.  Unmeasured in both directions, and the net is still
 * strongly favourable: the shapes measured live are the ones this fixes.
 *
 * A diagnostic bundle IS written at the two failure branches below (#890).
 * #857 deliberately left that undone — adding a capture site is a behaviour
 * change with its own acceptance, not part of fixing a parse — and the gap it
 * declared was closed on its own terms.  Both branches now call the same
 * {@link capturePostDetailExtractionFailure} `get-post` calls, which is why
 * that helper moved to `wait-for-post-load.ts`: two operations failing at the
 * same two outcomes of the same script on the same surface would otherwise
 * have kept two copies of one rule.  See ADR-007 § 2026-09-05 Amendment.
 */
const SCRAPE_POST_DETAIL_SCRIPT = buildPostDetailExtractionSource(
  adaptersFor(POST_DETAIL_SURFACE),
);

// ---------------------------------------------------------------------------
// Main operation
// ---------------------------------------------------------------------------

/**
 * Retrieve engagement statistics for a LinkedIn post.
 *
 * Connects to the LinkedIn webview in LinkedHelper, navigates to the
 * post detail page, and extracts engagement statistics from the
 * rendered DOM.
 *
 * @param input - Post URL or URN and CDP connection parameters.
 * @returns Engagement statistics for the post.
 */
export async function getPostStats(
  input: GetPostStatsInput,
): Promise<GetPostStatsOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;

  const postDetailUrl = resolvePostDetailUrl(input.postUrl);

  // Keep using extractPostUrn for the output postUrn field
  let postUrn: string;
  try {
    postUrn = extractPostUrn(input.postUrl);
  } catch {
    postUrn = input.postUrl;
  }

  // Enforce loopback guard
  if (!allowRemote && cdpHost !== "127.0.0.1" && cdpHost !== "localhost") {
    throw new Error(
      `Non-loopback CDP host "${cdpHost}" requires --allow-remote. ` +
        "This is a security measure to prevent remote code execution.",
    );
  }

  const targets = await discoverTargets(cdpPort, cdpHost);
  const linkedInTarget = targets.find(
    (t) => t.type === "page" && t.url?.includes("linkedin.com"),
  );

  if (!linkedInTarget) {
    throw new Error(
      "No LinkedIn page found in LinkedHelper. " +
        "Ensure LinkedHelper is running with an active LinkedIn session.",
    );
  }

  const client = new CDPClient(cdpPort, { host: cdpHost, allowRemote });
  await client.connect(linkedInTarget.id);

  try {
    // Navigate away if already on the post detail page to force a fresh load
    await navigateAwayIf(client, "/feed/update/");

    // Navigate to the post detail page
    await client.navigate(postDetailUrl);

    // Wait for the post content to render
    await waitForPostLoad(client);

    // Extract engagement stats from the DOM.  The script has already selected
    // the adapter and resolved its counts root; what arrives here is one of
    // the three selection outcomes, and neither of the two failures is an
    // empty record.  Refusing rather than returning zeroes is ADR-008's
    // empty-vs-error contract: a page nothing read is not a page with no
    // engagement on it.
    const raw = await client.evaluate<RawPostStats | AmbiguousPostStats>(
      SCRAPE_POST_DETAIL_SCRIPT,
    );
    if (!raw || isAmbiguous(raw)) {
      // Both branches are deadline-free extraction failures on a page whose
      // readiness gate went green milliseconds ago, so neither can be seen by
      // a timeout-bound capture.  Written before the throw, while the client
      // still holds the page: past it the `finally` disconnects and the DOM
      // that would have explained the failure is gone (#890).
      await capturePostDetailExtractionFailure(client);
      if (!raw) {
        // Zero adapters claimed the page, or the claiming adapter could not
        // resolve its own scope.  Either way nothing read the page.
        throw new DOMVariantUnsupportedError(
          POST_DETAIL_SURFACE,
          variantNamesFor(POST_DETAIL_SURFACE).map(String),
        );
      }
      throw new DOMVariantAmbiguousError(
        POST_DETAIL_SURFACE,
        raw.ambiguousVariants,
      );
    }

    const stats: PostStats = {
      postUrn,
      reactionCount: raw.reactionCount,
      reactionsByType: [],
      commentCount: raw.commentCount,
      shareCount: raw.shareCount,
    };

    await gaussianDelay(800, 300, 300, 1_800); // Post-action dwell
    return { stats };
  } finally {
    client.disconnect();
  }
}
