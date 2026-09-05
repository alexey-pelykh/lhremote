// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
} from "../services/errors.js";
import type { PostComment, PostDetail } from "../types/post.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import {
  capturePostDetailExtractionFailure,
  waitForPostLoad,
} from "../cdp/wait-for-post-load.js";
import { assertCardinalCorroboration } from "../linkedin/corroboration.js";
import {
  adaptersFor,
  buildPostDetailExtractionSource,
  variantNamesFor,
} from "../linkedin/dom-variant.js";
import { denormalizeCommentUrnToLegacy } from "../linkedin/selectors.js";
import { gaussianDelay } from "../utils/delay.js";
import type { ConnectionOptions } from "./types.js";
import { extractPostUrn, resolvePostDetailUrl } from "./get-post-stats.js";
import { delay, parseTimestamp } from "./get-feed.js";
import { navigateAwayIf } from "./navigate-away.js";

/**
 * Input for the get-post operation.
 */
export interface GetPostInput extends ConnectionOptions {
  /** LinkedIn post URL or raw URN (e.g. `urn:li:activity:1234567890`). */
  readonly postUrl: string;
  /**
   * Maximum number of comments to load.  The operation clicks "Load more
   * comments" until this limit is reached or no more comments are available.
   * Defaults to 100.  Set to 0 to skip comment loading entirely.
   */
  readonly commentCount?: number | undefined;
}

/**
 * Output from the get-post operation.
 */
export interface GetPostOutput {
  /** Full post detail. */
  readonly post: PostDetail;
  /** Comments on this post. */
  readonly comments: PostComment[];
  /**
   * Pagination metadata for {@link comments}, DERIVED from the returned list
   * alone.
   *
   * `total` is `comments.length`, so it carries no information `count` does
   * not: it describes this response, never how many comments the post has.
   * The post's own count is {@link PostDetail.commentCount}, read off the
   * page, and the two legitimately differ — a `commentCount` input truncates
   * the list, and `commentCount: 0` skips comment loading entirely.
   *
   * Documented rather than made independent (#836).  Setting `total` from
   * the scraped count would change what a shipped field means, and would
   * make `total < count` reachable on any page whose counts row is absent —
   * a behaviour change that belongs with its own acceptance criteria, not
   * alongside a fix to the count it would start reporting.
   */
  readonly commentsPaging: {
    readonly start: number;
    readonly count: number;
    /** Always `count`.  See the note on {@link commentsPaging}. */
    readonly total: number;
  };
}

// ---------------------------------------------------------------------------
// Raw shapes returned by the in-page scraping scripts
// ---------------------------------------------------------------------------

interface RawPostDetail {
  authorName: string | null;
  authorHeadline: string | null;
  authorProfileUrl: string | null;
  text: string | null;
  reactionCount: number;
  commentCount: number;
  shareCount: number;
  timestamp: string | null;
  /**
   * Which adapter produced this record.  Absent only when the scrape
   * predates the registry (no live path does).
   */
  variant?: string;
}

/**
 * Returned instead of a field bag when two or more adapters claimed the
 * page.  A transitional or hybrid page: picking one would build a record
 * out of two dialects with no way to notice, so it is reported rather than
 * resolved.
 */
interface AmbiguousPostDetail {
  ambiguousVariants: string[];
}

function isAmbiguous(
  raw: RawPostDetail | AmbiguousPostDetail,
): raw is AmbiguousPostDetail {
  return Array.isArray((raw as AmbiguousPostDetail).ambiguousVariants);
}

interface RawComment {
  commentUrn: string | null;
  authorName: string;
  authorHeadline: string | null;
  authorPublicId: string | null;
  text: string;
  createdAt: string | null;
  reactionCount: number;
}

// ---------------------------------------------------------------------------
// In-page DOM scraping scripts
// ---------------------------------------------------------------------------

/** The page kind this operation reads; picks the adapter list it binds to. */
const POST_DETAIL_SURFACE = "post-detail" as const;

/**
 * JavaScript source evaluated inside the LinkedIn post detail page to
 * extract post metadata from the rendered DOM.
 *
 * Generated from the post-detail adapter registry, not hand-written: the
 * script selects the one adapter whose detect anchor claims the page, scopes
 * to that adapter's own container, and runs that adapter's field extractors.
 *
 * **There is no terminal fallback.**  The cascade this replaced ended in
 * `document.querySelector('main') || document`, both of which always match —
 * so a page whose field selectors matched nothing still produced a valid
 * scope and returned an empty record with an HTTP success.  That is the
 * mechanism that turned a selector miss into a silent success.  Selection now
 * has three outcomes and none of them is a default: exactly one adapter
 * (extract), zero (`null`, raised as {@link DOMVariantUnsupportedError}), or
 * two-or-more (reported as `ambiguousVariants`).
 *
 * Registering a third dialect is an edit to the registry alone — nothing
 * here branches on the variant.
 */
const SCRAPE_POST_DETAIL_SCRIPT = buildPostDetailExtractionSource(
  adaptersFor(POST_DETAIL_SURFACE),
);

/**
 * JavaScript source evaluated inside the LinkedIn post detail page to
 * extract visible comments from the DOM.
 *
 * Post-2026-05 LinkedIn migrated comments from
 * `<article class="comments-comment-entity" data-id="urn:li:comment:..." />`
 * to `<div componentkey="replaceableComment_<URN>">` (lhremote#776).
 * Each logical comment renders as 3 nested elements sharing the same
 * `componentkey`; pick the OUTERMOST (max descendants) per URN to avoid
 * triple-counting.  See `research/linkedin/post-detail-comment-dom-react-sdui-20260506.md`
 * § 3 (comment DOM) and `post-detail-body-dom-react-sdui-20260507.md` § 6
 * (sister regression for `get-post.ts`).
 */
const SCRAPE_COMMENTS_SCRIPT = `(() => {
  // SDUI: dedupe by componentkey, picking the outermost element per URN.
  // Each logical comment renders as 3 nested elements sharing the same
  // componentkey (per the May 6 research).  The outermost element is the
  // one whose parent does NOT share its componentkey — checking the
  // parent is O(1) per element vs O(subtree-size) for descendant counting,
  // which matters on long comment lists.
  const allEls = document.querySelectorAll('[componentkey^="replaceableComment_"]');
  const byUrn = new Map();
  for (const el of allEls) {
    const ck = el.getAttribute('componentkey') || '';
    const parentCk = el.parentElement && el.parentElement.getAttribute('componentkey');
    if (parentCk === ck) continue; // not outermost
    const urn = ck.replace(/^replaceableComment_/, '');
    byUrn.set(urn, el);
  }

  const comments = [];
  for (const comment of byUrn.values()) {
    if (comment.offsetHeight < 30) continue;

    // --- Author ---
    let authorName = '';
    let authorHeadline = null;
    let authorPublicId = null;

    const authorLink = comment.querySelector('a[href*="/in/"]');
    if (authorLink) {
      const href = (authorLink.href || '').split('?')[0] || '';
      const idMatch = href.match(/\\/in\\/([^/?]+)/);
      if (idMatch) authorPublicId = idMatch[1];

      // Find an anchor (same href as authorLink) with non-empty text.
      // The textContent has these verified forms:
      //   "<Name>Author<Headline>"          (post-author commenting)
      //   "<Name>  • <degree><Name>  • <degree><Headline>" (regular other user)
      //   "<Name> Verified Profile <degree><Name>  • <degree><Headline>"
      //   "<Name> Premium Profile You<Name>  • You<Headline>"
      // Take everything before the first " • <degree>" or "Author" suffix.
      //
      // Iterate and compare attribute values directly rather than building a
      // CSS attribute selector via concatenation — see post-author scraper
      // above (same defense against CSS-special characters in raw hrefs).
      const targetHref = authorLink.getAttribute('href');
      for (const a of comment.querySelectorAll('a')) {
        if (a.getAttribute('href') !== targetHref) continue;
        const t = (a.textContent || '').trim();
        if (t.length === 0) continue;
        const m = t.match(/^(.+?)(?:\\s+•\\s+(?:1st|2nd|3rd|Out of network|You)|Author)/);
        let raw = m ? m[1] : t.split('\\n')[0];
        // Strip "Verified Profile" / "Premium Profile" decorations and any
        // duplicated name that LinkedIn injects after them.  The badge
        // can appear mid-string in forms like
        //   "Alexey Pelykh Premium Profile YouAlexey Pelykh" (regex match
        //    captured up to the first " • You" position),
        // so anchoring on Profile-end-of-string would miss it.  Truncate
        // from the first badge-token occurrence onwards.
        raw = raw.replace(/\\s+(?:Verified|Premium)\\s+Profile\\b.*$/, '').trim();
        if (raw.length > 0) {
          authorName = raw;
          break;
        }
      }
    }

    // --- Author headline ---
    // Apply same headline heuristics as the post body, scoped to comment.
    const headlineCandidates = comment.querySelectorAll('p, span');
    for (const el of headlineCandidates) {
      const txt = (el.textContent || '').trim();
      if (
        txt &&
        txt.length > 5 &&
        txt.length < 200 &&
        txt !== authorName &&
        !txt.match(/^\\d+[smhdw]$/) &&
        !txt.match(/^\\d[\\d,]*\\s+(reactions?|comments?|reposts?|likes?)$/i) &&
        !txt.match(/^Reply$|^Like$|^Author$|^You$/i) &&
        !txt.match(/^(?:Verified|Premium)\\s+Profile$/) &&
        !txt.match(/Reaction button state:/) &&
        !txt.includes('•')
      ) {
        authorHeadline = txt;
        break;
      }
    }

    // --- Comment text ---
    // expandable-text-box does NOT exist inside comments (only in post
    // body); use longest text leaf approach scoped to the comment.
    let text = '';
    const textCandidates = comment.querySelectorAll('p, span');
    for (const el of textCandidates) {
      const txt = (el.textContent || '').trim();
      if (txt.length > text.length && txt !== authorName && txt !== authorHeadline) {
        // Skip composite spans that contain author info
        if (authorName && authorHeadline && txt.includes(authorName) && txt.includes(authorHeadline)) continue;
        // Skip Reaction button state mirrors
        if (/Reaction button state:/.test(txt)) continue;
        // Skip degree-suffix composites
        if (/\\s+•\\s+(?:1st|2nd|3rd|You|Out of network)/.test(txt) && txt.length < 60) continue;
        text = txt;
      }
    }

    // Skip if no meaningful content
    if (!text && !authorName) continue;

    // --- Comment URN (from componentkey, SDUI format) ---
    const ck = comment.getAttribute('componentkey') || '';
    const commentUrn = ck.replace(/^replaceableComment_/, '') || null;

    // --- Timestamp (relative time pattern; SDUI page has no <time>) ---
    let createdAt = null;
    const commentText = comment.textContent || '';
    const timeMatch = commentText.match(/(?:1st|2nd|3rd|You)(\\d+[smhdw]|[1-9]\\d*mo)/) ||
                      commentText.match(/(?:^|\\s)(\\d+[smhdw]|[1-9]\\d*mo)(?:\\s|$)/);
    if (timeMatch) createdAt = timeMatch[1];

    // --- Reaction count (existing pattern) ---
    let reactionCount = 0;
    const likesMatch = commentText.match(/(\\d[\\d,]*)\\s+reactions?/i);
    if (likesMatch) {
      reactionCount = parseInt(likesMatch[1].replace(/,/g, ''), 10) || 0;
    }

    comments.push({
      commentUrn,
      authorName,
      authorHeadline,
      authorPublicId,
      text,
      createdAt,
      reactionCount,
    });
  }

  return comments;
})()`;

/**
 * JavaScript source that finds and clicks the "Load more comments" button.
 * Returns `true` if a button was clicked, `false` otherwise.
 *
 * LinkedIn renders the load-more trigger as a `button` or `span` whose
 * text content includes "Load more comments" (or locale equivalents).
 * The script also recognises "Load previous replies" for nested threads.
 */
const CLICK_LOAD_MORE_COMMENTS_SCRIPT = `(() => {
  const loadMoreTexts = [
    'load more comments', 'show more comments', 'show previous replies',
    'load previous replies', 'view more comments',
  ];

  // Try buttons first, then spans and anchors
  const candidates = [
    ...document.querySelectorAll('button'),
    ...document.querySelectorAll('span[role="button"]'),
  ];

  for (const el of candidates) {
    const txt = (el.textContent || '').trim().toLowerCase();
    if (loadMoreTexts.some(t => txt.includes(t))) {
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    }
  }
  return false;
})()`;

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract public identifier from a LinkedIn profile URL.
 */
function extractPublicId(url: string | null): string | null {
  if (!url) return null;
  const match = /\/in\/([^/?]+)/.exec(url);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Main operation
// ---------------------------------------------------------------------------

/**
 * Retrieve detailed data for a single LinkedIn post with its comment thread.
 *
 * Connects to the LinkedIn webview in LinkedHelper, navigates to the
 * post detail page, and extracts post data and comments from the
 * rendered DOM.
 *
 * @param input - Post URL or URN, and CDP connection options.
 * @returns Post detail with comments and pagination metadata.
 */
export async function getPost(input: GetPostInput): Promise<GetPostOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const maxComments = input.commentCount ?? 100;

  const postDetailUrl = resolvePostDetailUrl(input.postUrl);

  // Try to extract URN for the output postUrn field
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

    // Extract post metadata from the DOM.  The script has already selected
    // the adapter; what arrives here is one of the three selection outcomes.
    const rawPost = await client.evaluate<RawPostDetail | AmbiguousPostDetail>(
      SCRAPE_POST_DETAIL_SCRIPT,
    );
    if (!rawPost || isAmbiguous(rawPost)) {
      // Both branches are deadline-free extraction failures on a page whose
      // readiness gate went green milliseconds ago, so #835's widening covers
      // them for the same reason it covers the cardinal contradiction below —
      // and the issue names all three error classes, not just the third.
      await capturePostDetailExtractionFailure(client);
      if (!rawPost) {
        // Zero adapters claimed the page, or the claiming adapter could not
        // resolve its own scope.  Either way nothing read the page, and there
        // is no `<main>` left to pretend otherwise with.
        throw new DOMVariantUnsupportedError(
          POST_DETAIL_SURFACE,
          variantNamesFor(POST_DETAIL_SURFACE).map(String),
        );
      }
      // Two or more adapters claimed it.  Refuse rather than pick: a record
      // assembled from two dialects is wrong in a way nothing downstream can
      // detect.
      throw new DOMVariantAmbiguousError(
        POST_DETAIL_SURFACE,
        rawPost.ambiguousVariants,
      );
    }

    const post: PostDetail = {
      postUrn,
      authorName: rawPost.authorName ?? "",
      authorHeadline: rawPost.authorHeadline ?? null,
      authorPublicId: extractPublicId(rawPost.authorProfileUrl),
      text: rawPost.text ?? "",
      publishedAt: parseTimestamp(rawPost.timestamp),
      reactionCount: rawPost.reactionCount,
      commentCount: rawPost.commentCount,
      shareCount: rawPost.shareCount,
    };

    // --- Comment loading ---
    // Click "Load more comments" repeatedly until we have enough or no more
    // are available.  Each click loads an additional batch of comments.
    //
    // Post-2026-05 SDUI: comments are 3-nested elements sharing
    // `componentkey="replaceableComment_<URN>"`.  Count distinct logical
    // comments by picking the OUTERMOST element per URN (parent componentkey
    // differs from this element's), matching the SCRAPE_COMMENTS_SCRIPT
    // dedupe heuristic.  Raw element count would triple-overshoot
    // maxComments.  See lhremote#776 / #800.
    const maxLoadMoreAttempts = 20;
    if (maxComments > 0) {
      for (let attempt = 0; attempt < maxLoadMoreAttempts; attempt++) {
        const currentCount = await client.evaluate<number>(
          `(function () { let n = 0; document.querySelectorAll('[componentkey^="replaceableComment_"]').forEach(function (el) { const ck = el.getAttribute('componentkey'); if (!ck) return; const parentCk = el.parentElement && el.parentElement.getAttribute('componentkey'); if (parentCk !== ck) n++; }); return n; })()`,
        );
        if (currentCount >= maxComments) break;

        const clicked = await client.evaluate<boolean>(CLICK_LOAD_MORE_COMMENTS_SCRIPT);
        if (!clicked) break;

        await delay(1500);
      }
    }

    // Extract all visible comments from the DOM
    const rawComments = await client.evaluate<RawComment[]>(SCRAPE_COMMENTS_SCRIPT);
    const allRaw = rawComments ?? [];

    // Corroborate the scrape before trusting an empty one.  `commentCount` was
    // read off the very page this scrape ran against, so the count and the
    // scrape are two halves of one observation, and their disagreeing is a
    // self-contradiction rather than two readings of different things — the
    // shape the defect took live: `commentCount: 41` returned next to
    // `comments: []` (#834).
    //
    // Only when comments were actually asked for.  `commentCount: 0` on the
    // input means "skip comment loading entirely", so the empty list is the
    // caller's own instruction rather than an observation, and there is
    // nothing for the cardinal to contradict.
    if (maxComments > 0) {
      try {
        assertCardinalCorroboration({
          surface: POST_DETAIL_SURFACE,
          variant: rawPost.variant ?? "unknown",
          field: "comments",
          cardinalName: "commentCount",
          cardinal: post.commentCount,
          extractedCount: allRaw.length,
        });
      } catch (error) {
        // Capture on the way out (#835).  `assertCardinalCorroboration` is a
        // pure predicate and holds no CDP client, so the capture cannot live
        // inside it — this is the nearest frame that still has the page open,
        // and it is the last one: past this `throw` the `finally` disconnects
        // the client and the DOM that would have explained the failure is
        // gone.
        //
        // Why capture here at all, when the readiness gate already captures:
        // this failure never reaches a deadline.  The gate went green in
        // milliseconds, an adapter matched, the post body extracted fine —
        // and then `commentCount: 41` came back next to `comments: []`.  A
        // timeout-gated capture cannot see that, which left the ADR-007
        // directive "inspect these artifacts before changing post-detail
        // selectors" undischargeable for exactly this defect class.
        //
        // Swallows its own errors, so `error` propagates unchanged either way.
        await capturePostDetailExtractionFailure(client);
        throw error;
      }
    }

    const limited = maxComments > 0 ? allRaw.slice(0, maxComments) : [];

    const comments: PostComment[] = limited.map((c) => ({
      // Renormalize to legacy URN shape so get-post's API output stays
      // backward-compatible with pre-SDUI consumers (the SDUI rewrite
      // changed the in-DOM URN format from `(activity:N,M)` to
      // `(urn:li:activity:N,M)`; without renormalization we'd silently
      // break that contract).
      commentUrn: c.commentUrn ? denormalizeCommentUrnToLegacy(c.commentUrn) : null,
      authorName: c.authorName,
      authorHeadline: c.authorHeadline,
      authorPublicId: c.authorPublicId,
      text: c.text,
      createdAt: parseTimestamp(c.createdAt),
      reactionCount: c.reactionCount,
    }));

    await gaussianDelay(800, 300, 300, 1_800); // Post-action dwell
    return {
      post,
      comments,
      commentsPaging: {
        start: 0,
        count: comments.length,
        total: comments.length,
      },
    };
  } finally {
    client.disconnect();
  }
}
