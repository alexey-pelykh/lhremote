// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import type { FeedPost } from "../types/feed.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { probeVariantDetection } from "../cdp/wait-for-post-load.js";
import { assertCardinalCorroboration } from "../linkedin/corroboration.js";
import {
  adaptersFor,
  buildReadinessPredicateSource,
  buildSearchResultsExtractionSource,
  formatVariantProbes,
  SEARCH_RESULT_CARD_MENU_BUTTON,
  type VariantDetection,
  variantNamesFor,
} from "../linkedin/dom-variant.js";
import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
  ExtractionTimeoutError,
} from "../services/errors.js";
import type { ConnectionOptions } from "./types.js";
import { navigateAwayIf } from "./navigate-away.js";
import { gateOnLoggedInState } from "./wait-for-logged-in-state.js";
import { gaussianDelay, gaussianBetween, maybeHesitate, maybeBreak, simulateReadingTime } from "../utils/delay.js";
import { humanizedScrollToByIndex, retryInteraction } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import {
  type RawDomPost,
  mapRawPosts,
  scrollFeed,
  delay,
} from "./get-feed.js";

/** The page kind this operation reads; picks the adapter list it binds to. */
const SEARCH_RESULTS_SURFACE = "search-results" as const;

/**
 * Input for the search-posts operation.
 */
export interface SearchPostsInput extends ConnectionOptions {
  /** Search query (keywords or hashtag, e.g. `"AI agents"` or `"#AIAgents"`). */
  readonly query: string;
  /** Number of results per page (default: 10). */
  readonly count?: number | undefined;
  /** Index-based cursor (offset) from a previous search-posts call for the next page. */
  readonly cursor?: number | undefined;
  /** Optional humanized mouse for natural cursor movement and scrolling. */
  readonly mouse?: HumanizedMouse | null | undefined;
}

/**
 * Output from the search-posts operation.
 */
export interface SearchPostsOutput {
  /** The search query that was executed. */
  readonly query: string;
  /** List of matching posts. */
  readonly posts: FeedPost[];
  /** Index-based cursor (offset) for retrieving the next page, or null if no more pages. */
  readonly nextCursor: number | null;
}

// ---------------------------------------------------------------------------
// Search-results DOM extraction
// ---------------------------------------------------------------------------

/**
 * One successful scrape of the search-results page.
 *
 * `postCardCount` is the cardinal that corroborates an empty `posts`: the
 * number of enumerated cards that were post-shaped before the control-menu
 * filter ran.  Its exact definition, and why it is the one filter held back,
 * live on {@link buildSearchResultsExtractionSource}.
 */
interface RawSearchResults {
  variant: string;
  postCardCount: number;
  posts: RawDomPost[];
}

/** Two or more adapters claimed the page. */
interface AmbiguousSearchResults {
  ambiguousVariants: string[];
}

function isAmbiguous(
  raw: RawSearchResults | AmbiguousSearchResults,
): raw is AmbiguousSearchResults {
  return Array.isArray((raw as AmbiguousSearchResults).ambiguousVariants);
}

/**
 * JavaScript evaluated inside the LinkedIn search-results page.
 *
 * Generated from the surface's adapter registry, so the dialect is detected on
 * the page being read rather than assumed.  Both registered dialects extract
 * through it; nothing here branches on the variant.
 */
const SCRAPE_SEARCH_RESULTS_SCRIPT = buildSearchResultsExtractionSource(
  adaptersFor(SEARCH_RESULTS_SURFACE),
);

// ---------------------------------------------------------------------------
// Search-results readiness gate
// ---------------------------------------------------------------------------

/**
 * The `cause` a zero-match failure on THIS surface carries.
 *
 * `DOMVariantUnsupportedError`'s own wording asserts one reading — *LinkedIn
 * has changed its markup, register an adapter*.  On post detail that reading
 * is sound, because a post-detail page always has a post: if no adapter claims
 * it, the markup moved.  **This surface does not have that property.**  A
 * search that matched nothing renders no result cards, so no adapter's
 * `detect` anchor can match either, and an operator is sent to write an
 * adapter for a page that is working perfectly.
 *
 * The two states really are indistinguishable *from the DOM* with what is
 * measured today: no live probe of a zero-result search page exists, so there
 * is no measured "empty results" container for either dialect to anchor on.
 * Guessing one would put an unmeasured selector where the registry requires a
 * decisive one — the defect class this whole binding removes.
 *
 * So the cause states what was OBSERVED — no registered adapter's detect
 * anchor matched, with the per-adapter probe counts — and names BOTH readings,
 * rather than leaving the error's own wording to assert the first.
 *
 * Failing loud remains right, and neither half of that is incidental.
 * Returning `posts: []` here would hand a caller an empty result it cannot
 * tell apart from a dialect flip, which is exactly what ADR-008 § Decision 4
 * forbids; and softening the class would lose the one operator action that is
 * right under the first reading.  What was wrong was the diagnosis, not the
 * refusal.  See ADR-008 § 2026-09-02 Amendment.
 *
 * @param detection - The deadline classification probe's own reading.
 */
function zeroMatchCause(detection: VariantDetection): Error {
  return new Error(
    `detect probes — ${formatVariantProbes(detection)}. ` +
      "No registered adapter's detect anchor matched. That observation has TWO " +
      "readings on the search-results surface and the DOM cannot tell them " +
      "apart: LinkedIn changed its markup (register an adapter for the new " +
      "dialect), OR the search legitimately matched nothing (a result-less " +
      "page renders no cards, so there is no card for any detect anchor to " +
      "match). Confirm the query returns results before writing an adapter.",
  );
}

/**
 * Poll the DOM until the search-results page has rendered *in a dialect an
 * adapter can read*.
 *
 * The predicate is generated from the search-results adapter registry and is
 * satisfied only when exactly one adapter claims the page AND that adapter's
 * own readiness anchor is present — ADR-008 § Decision 1, applied to a second
 * surface.  The predicate it replaced asked only whether any
 * `div[role="listitem"]` held a post control menu, which is variant-agnostic:
 * it went green on a legacy page every scraper selector matched 0 on, which is
 * the whole defect class.
 *
 * **Why zero-match does not raise inside the loop.**  A page that has not
 * hydrated yet also matches zero adapters, so failing fast would be
 * indistinguishable from "LinkedIn changed" and would fire on every slow load.
 * The loop polls first and classifies once, at the deadline, when "not yet"
 * has been ruled out:
 *
 * | Adapters matching at the deadline | Error |
 * |---|---|
 * | zero | {@link DOMVariantUnsupportedError} — see {@link zeroMatchCause} for what that does and does not establish here |
 * | two or more | {@link DOMVariantAmbiguousError} — tighten the detect anchors |
 * | exactly one | {@link ExtractionTimeoutError} — the dialect is known, it never finished rendering |
 *
 * A classification probe that did not run usefully degrades to `null`, which
 * is NOT the claim "no adapter matched": the ordinary timeout is raised rather
 * than blaming LinkedIn for a broken instrument.
 *
 * **This gate is the only path a genuinely empty search takes**, which is why
 * {@link zeroMatchCause} lives here and nowhere else.  A zero-result page
 * renders no cards, so no `detect` anchor matches, so readiness can never go
 * green on one — and the extraction below therefore never sees it.
 *
 * @param client    - Connected CDP client targeting the search-results page.
 * @param timeoutMs - Polling deadline in milliseconds (default: 15s).
 *
 * @throws {@link DOMVariantUnsupportedError} No adapter claimed the page.
 * @throws {@link DOMVariantAmbiguousError} Two or more adapters claimed it.
 * @throws {@link ExtractionTimeoutError} The selected adapter never became ready.
 *
 * @internal Exported for testing.
 */
export async function waitForSearchResults(
  client: CDPClient,
  timeoutMs = 15_000,
): Promise<void> {
  const adapters = adaptersFor(SEARCH_RESULTS_SURFACE);
  const predicate = buildReadinessPredicateSource(adapters);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate<boolean>(predicate);
    if (ready) return;
    await delay(500);
  }

  // Classify what the page actually is before reporting.  One probe, on the
  // failure path only — the happy path pays nothing for it.
  const detection = await probeVariantDetection(client, adapters);
  if (detection) {
    if (detection.matched.length === 0) {
      throw new DOMVariantUnsupportedError(
        SEARCH_RESULTS_SURFACE,
        variantNamesFor(SEARCH_RESULTS_SURFACE).map(String),
        { cause: zeroMatchCause(detection) },
      );
    }
    if (detection.matched.length > 1) {
      throw new DOMVariantAmbiguousError(
        SEARCH_RESULTS_SURFACE,
        detection.matched,
        {
          cause: new Error(`detect probes — ${formatVariantProbes(detection)}`),
        },
      );
    }
  }

  // Exactly one adapter matched (or classification was unavailable): the
  // dialect is known and it genuinely timed out.
  throw new ExtractionTimeoutError(
    `readiness anchor of the selected ${SEARCH_RESULTS_SURFACE} adapter`,
    timeoutMs,
    "Search-results",
  );
}

/**
 * Search LinkedIn for posts matching a keyword query.
 *
 * Connects to the LinkedIn webview in LinkedHelper, navigates to the
 * content search page, and extracts posts from the rendered DOM.
 * Supports keyword search, hashtag search, and cursor-based pagination.
 *
 * @param input - Search query, pagination parameters, and CDP connection options.
 * @returns List of matching posts with cursor for the next page.
 */
export async function searchPosts(
  input: SearchPostsInput,
): Promise<SearchPostsOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const count = input.count ?? 10;
  const cursor = input.cursor ?? null;

  if (!input.query.trim()) {
    throw new Error("Search query must not be empty");
  }

  // Enforce loopback guard
  if (!allowRemote && cdpHost !== "127.0.0.1" && cdpHost !== "localhost") {
    throw new Error(
      `Non-loopback CDP host "${cdpHost}" requires --allow-remote. ` +
        "This is a security measure to prevent remote code execution.",
    );
  }

  await gateOnLoggedInState(cdpPort, cdpHost, allowRemote, { timeout: 60_000 });

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
    // Navigate away if already on the search page to force a fresh load
    await navigateAwayIf(client, "/search/results/");

    // Navigate to LinkedIn content search
    const searchUrl = new URL(
      "https://www.linkedin.com/search/results/content/",
    );
    searchUrl.searchParams.set("keywords", input.query);
    searchUrl.searchParams.set("origin", "GLOBAL_SEARCH_HEADER");
    await client.navigate(searchUrl.toString());

    // Wait for the search results to render
    await waitForSearchResults(client);

    const mouse = input.mouse ?? null;

    // Collect posts — scroll to load more if needed.
    //
    // Cursor is an index-based offset (e.g. "10" means start from post
    // at index 10).  URN-based cursors are not possible because search
    // result posts don't expose URNs in the DOM.
    const maxScrollAttempts = 10;
    let allPosts: RawDomPost[] = [];
    let previousCount = 0;
    // The final scrape's own report of itself.  Seeded rather than left
    // undefined only to satisfy the type checker: the loop below always runs
    // at least once and either assigns both or throws.
    let variant = "unknown";
    let postCardCount = 0;

    const startIdx = cursor ?? 0;
    if (startIdx < 0) {
      throw new Error(`Invalid cursor ${String(cursor)} — must be a non-negative integer offset`);
    }

    for (let scroll = 0; scroll <= maxScrollAttempts; scroll++) {
      const countBeforeScroll = previousCount;
      const scraped = await client.evaluate<
        RawSearchResults | AmbiguousSearchResults | null
      >(SCRAPE_SEARCH_RESULTS_SCRIPT);

      if (!scraped) {
        // Zero adapters claimed the page, or the claiming adapter enumerated
        // no cards.  Either way nothing read the page — and there is no
        // `<main>` left to pretend otherwise with.
        //
        // The error's own "LinkedIn changed its markup" reading IS sound here,
        // and deliberately carries no `zeroMatchCause` qualifier: readiness
        // already went green above, so exactly one adapter's detect anchor
        // matched a card on this page moments ago.  A search that found
        // nothing could never have got this far.
        throw new DOMVariantUnsupportedError(
          SEARCH_RESULTS_SURFACE,
          variantNamesFor(SEARCH_RESULTS_SURFACE).map(String),
        );
      }
      if (isAmbiguous(scraped)) {
        // Two or more adapters claimed it.  Refuse rather than pick: a record
        // assembled from two dialects is wrong in a way nothing downstream
        // can detect.
        throw new DOMVariantAmbiguousError(
          SEARCH_RESULTS_SURFACE,
          scraped.ambiguousVariants,
        );
      }

      allPosts = scraped.posts;
      variant = scraped.variant;
      postCardCount = scraped.postCardCount;

      const available = allPosts.length - startIdx;
      if (available >= count) break;

      // No new posts appeared after scroll — stop
      if (allPosts.length === previousCount && scroll > 0) break;
      previousCount = allPosts.length;

      // Scroll to load more
      if (scroll < maxScrollAttempts) {
        await scrollFeed(client, mouse);

        // Progressive session fatigue: delays increase with each scroll
        const fatigueMultiplier = 1 + scroll * 0.1;
        // Scale delay by newly visible content volume
        const newPostCount = allPosts.length - countBeforeScroll;
        const contentBonus = Math.min(
          newPostCount * gaussianBetween(350, 75, 200, 500),
          3_000,
        );
        await gaussianDelay(
          1_500 * fatigueMultiplier + contentBonus,
          150 * fatigueMultiplier,
          1_200 * fatigueMultiplier + contentBonus,
          1_800 * fatigueMultiplier + contentBonus,
        );

        // Reading simulation: pause proportional to visible content volume.
        // Estimate ~300 chars per newly visible post (headline + snippet).
        if (newPostCount > 0) {
          await simulateReadingTime(newPostCount * 300);
        }

        await maybeBreak();
      }
    }

    // Corroborate the scrape before trusting an empty one.  `postCardCount`
    // was counted on the very cards this scrape ran over, so the count and
    // the scrape are two halves of one observation, and their disagreeing is
    // a self-contradiction rather than two readings of different things.
    //
    // Both directions are load-bearing, and only one of them is an error:
    // `postCardCount > 0` next to no posts means every card was skipped —
    // under legacy markup that is exactly what an SDUI-only scraper did — and
    // raises; `postCardCount === 0` means the page rendered no post-shaped
    // cards, which is what a search that genuinely found nothing looks like,
    // and returns normally with `posts: []`.
    //
    // Placed AFTER the scroll loop and BEFORE the cursor window is sliced,
    // for two independent reasons.  `scrollFeed` re-scrapes in a loop and an
    // early scrape can legitimately be empty while results are still
    // streaming in, so only the settled scrape is evidence.  And a cursor
    // past the end of a non-empty scrape legitimately yields an empty window,
    // which is a pagination fact about the caller's request rather than an
    // observation about the page.
    assertCardinalCorroboration({
      surface: SEARCH_RESULTS_SURFACE,
      variant,
      field: "posts",
      cardinalName: "postCardCount",
      cardinal: postCardCount,
      extractedCount: allPosts.length,
    });

    // --- URL extraction via three-dot menu → "Copy link to post" ---
    // Search result posts don't expose URLs in the DOM.  For each post
    // with urn === null, open the three-dot menu, click "Copy link to
    // post" which writes the URL to the clipboard.
    //
    // Note: URNs are NOT extractable from search results — only the URL
    // is captured here.  Do not attempt to reconstruct URNs from URLs.
    //
    // Electron's clipboard API is broken (readText returns {}) so we
    // monkey-patch navigator.clipboard.writeText to capture into a
    // window global instead.
    const needsUrlExtraction = allPosts.some((p) => p.url === null);
    if (needsUrlExtraction) {
      // Install clipboard interceptor once
      await client.evaluate(
        `navigator.clipboard.writeText = function(text) {
          window.__capturedClipboard = text;
          return Promise.resolve();
        };`,
      );

      // The click target is imported from the shared card skeleton rather than
      // written out again here: it is the same element the readiness gate
      // polls and the card loop filters on, and a third hand-written copy is
      // how one measurement drifts into two.
      //
      // It addresses buttons through the card SKELETON, though, not through
      // the selected adapter's own enumeration root — so the i-th button is
      // the i-th post only as far as the two enumerations agree.  They already
      // disagree wherever a card was skipped (height floor, no author link),
      // which is pre-existing; under a dialect whose cards are not listitems
      // they would not overlap at all and no URL would be read.  Both
      // degradations leave `url: null` on the affected posts rather than a
      // wrong URL, and closing them means a per-card handle the extraction
      // does not return today — a follow-up, not this binding.
      for (let i = 0; i < allPosts.length; i++) {
        const post = allPosts[i];
        if (!post || post.url) continue;

        if (i > 0) await gaussianDelay(550, 125, 300, 800); // Inter-post delay
        await maybeBreak();

        const url = await retryInteraction(async () => {
          await maybeHesitate(); // Probabilistic pause before menu interaction

          // Reset capture
          await client.evaluate(`window.__capturedClipboard = null;`);

          // Scroll the menu button into view (humanized when mouse available)
          await humanizedScrollToByIndex(client, SEARCH_RESULT_CARD_MENU_BUTTON, i, mouse);

          // Click the i-th menu button
          const clicked = await client.evaluate<boolean>(`(() => {
            const btns = document.querySelectorAll(
              ${JSON.stringify(SEARCH_RESULT_CARD_MENU_BUTTON)}
            );
            const btn = btns[${String(i)}];
            if (!btn) return false;
            btn.click();
            return true;
          })()`);
          if (!clicked) return null;

          await gaussianDelay(700, 100, 500, 900);

          // Click "Copy link to post" menu item
          await client.evaluate(`(() => {
            for (const el of document.querySelectorAll('[role="menuitem"]')) {
              if (el.textContent.trim() === 'Copy link to post') {
                el.click();
                return;
              }
            }
          })()`);

          await gaussianDelay(550, 75, 400, 700);

          // Read captured URL
          return client.evaluate<string | null>(`window.__capturedClipboard`);
        });

        if (url) {
          post.url = url.split("?")[0] ?? url;
        }
      }
    }

    // Slice the result window
    const window = allPosts.slice(startIdx, startIdx + count);
    const posts = mapRawPosts(window);

    // Determine next cursor (index-based offset)
    const hasMore = startIdx + count < allPosts.length;
    const nextCursor = hasMore ? startIdx + count : null;

    await gaussianDelay(800, 300, 300, 1_800); // Post-action dwell
    return { query: input.query, posts, nextCursor };
  } finally {
    client.disconnect();
  }
}
