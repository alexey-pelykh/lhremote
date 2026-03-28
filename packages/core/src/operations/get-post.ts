// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { PostComment, PostDetail } from "../types/post.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
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
  /** Comment pagination metadata. */
  readonly commentsPaging: {
    readonly start: number;
    readonly count: number;
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
}

interface RawComment {
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

/**
 * JavaScript source evaluated inside the LinkedIn post detail page to
 * extract post metadata from the rendered DOM.
 *
 * The post detail page (`/feed/update/{urn}/`) renders a single post
 * using the same SSR feed structure as the home feed.  The script looks
 * for `[data-testid="mainFeed"]` → `div[role="listitem"]` first, then
 * falls back to the full document.
 */
const SCRAPE_POST_DETAIL_SCRIPT = `(() => {
  let authorName = null;
  let authorHeadline = null;
  let authorProfileUrl = null;
  let text = null;
  let reactionCount = 0;
  let commentCount = 0;
  let shareCount = 0;
  let timestamp = null;

  // Narrow scope: try mainFeed listitem, then <main>, then document
  let scope = document.querySelector('main') || document;
  const feedList = document.querySelector('[data-testid="mainFeed"]');
  if (feedList) {
    const items = feedList.querySelectorAll('div[role="listitem"]');
    for (const item of items) {
      if (item.offsetHeight < 100) continue;
      const menuBtn = item.querySelector('button[aria-label^="Open control menu for post"]');
      if (menuBtn) {
        scope = item;
        break;
      }
    }
  }

  // --- Author info ---
  const authorLink = scope.querySelector('a[href*="/in/"], a[href*="/company/"]');
  if (authorLink) {
    authorProfileUrl = authorLink.href.split('?')[0] || null;

    // Try name from span inside the link first
    const nameSpan = authorLink.querySelector('span[dir="ltr"], span[aria-hidden="true"]');
    let rawName = nameSpan ? (nameSpan.textContent || '').trim() : '';

    // Fallback: link's own textContent (trimmed, first line only)
    if (!rawName) {
      rawName = (authorLink.textContent || '').trim().split('\\n')[0].trim();
    }

    // Fallback: look for a nearby heading or span that contains the name
    // (LinkedIn sometimes renders the name outside the <a> tag)
    if (!rawName) {
      const parent = authorLink.closest('div');
      if (parent) {
        const nearby = parent.querySelector('span[dir="ltr"], span[aria-hidden="true"]');
        if (nearby) rawName = (nearby.textContent || '').trim();
      }
    }

    authorName = rawName || null;
  }

  // --- Author headline ---
  // Search within <main> scope, skip navigation text and the author name
  const allSpans = scope.querySelectorAll('span');
  for (const span of allSpans) {
    const txt = (span.textContent || '').trim();
    if (
      txt &&
      txt.length > 5 &&
      txt.length < 200 &&
      txt !== authorName &&
      !txt.match(/^\\d+[smhdw]$/) &&
      !txt.match(/^\\d[\\d,]*\\s+(reactions?|comments?|reposts?|likes?)$/i) &&
      !txt.match(/^Follow$|^Promoted$/i) &&
      !txt.match(/^Skip to|^Keyboard shortcuts$|^Close jump menu$/i) &&
      !txt.match(/^Feed detail update$|^Feed post$/i)
    ) {
      authorHeadline = txt;
      break;
    }
  }

  // --- Post text ---
  const ltrSpans = scope.querySelectorAll('span[dir="ltr"]');
  let longestText = '';
  for (const span of ltrSpans) {
    const txt = (span.textContent || '').trim();
    if (txt.length > longestText.length && txt !== authorName && txt !== authorHeadline) {
      longestText = txt;
    }
  }
  if (longestText.length > 20) {
    text = longestText;
  }

  // --- Engagement counts ---
  const countText = document.body.textContent || '';

  function parseCount(pattern) {
    const m = countText.match(pattern);
    if (!m) return 0;
    const raw = m[1].replace(/,/g, '');
    const num = parseInt(raw, 10);
    return isNaN(num) ? 0 : num;
  }

  reactionCount = parseCount(/(\\d[\\d,]*)\\s+reactions?/i);
  commentCount = parseCount(/(\\d[\\d,]*)\\s+comments?/i);
  shareCount = parseCount(/(\\d[\\d,]*)\\s+reposts?/i);

  // --- Timestamp ---
  const timeEl = scope.querySelector('time');
  if (timeEl) {
    const dt = timeEl.getAttribute('datetime');
    if (dt) timestamp = dt;
  }
  if (!timestamp) {
    const scopeText = scope.textContent || '';
    const timeMatch = scopeText.match(/(?:^|\\s)(\\d+[smhdw])(?:\\s|$|\\u00B7|\\xB7)/);
    if (timeMatch) timestamp = timeMatch[1];
  }

  return {
    authorName,
    authorHeadline,
    authorProfileUrl,
    text,
    reactionCount,
    commentCount,
    shareCount,
    timestamp,
  };
})()`;

/**
 * JavaScript source evaluated inside the LinkedIn post detail page to
 * extract visible comments from the DOM.
 *
 * Comments are rendered as `article` elements containing an author link
 * and text content.  Only first-page (visible) comments are extracted;
 * "Load more" is not clicked.
 */
const SCRAPE_COMMENTS_SCRIPT = `(() => {
  const comments = [];
  const articles = document.querySelectorAll('article');

  for (const article of articles) {
    if (article.offsetHeight < 30) continue;

    // --- Author ---
    let authorName = '';
    let authorHeadline = null;
    let authorPublicId = null;
    const authorLink = article.querySelector('a[href*="/in/"]');

    if (authorLink) {
      const nameSpan = authorLink.querySelector('span[dir="ltr"], span[aria-hidden="true"]');
      authorName = nameSpan ? (nameSpan.textContent || '').trim() : '';
      if (!authorName) {
        authorName = (authorLink.textContent || '').trim().split('\\n')[0].trim();
      }
      if (!authorName) {
        const parent = authorLink.closest('div');
        if (parent) {
          const nearby = parent.querySelector('span[dir="ltr"], span[aria-hidden="true"]');
          if (nearby) authorName = (nearby.textContent || '').trim();
        }
      }

      const href = authorLink.href.split('?')[0] || '';
      const idMatch = href.match(/\\/in\\/([^/?]+)/);
      if (idMatch) authorPublicId = idMatch[1];
    }

    // --- Author headline ---
    const spans = article.querySelectorAll('span');
    for (const span of spans) {
      const txt = (span.textContent || '').trim();
      if (
        txt &&
        txt.length > 5 &&
        txt.length < 200 &&
        txt !== authorName &&
        !txt.match(/^\\d+[smhdw]$/) &&
        !txt.match(/^\\d[\\d,]*\\s+(reactions?|comments?|reposts?|likes?)$/i) &&
        !txt.match(/^Reply$|^Like$/i)
      ) {
        authorHeadline = txt;
        break;
      }
    }

    // --- Comment text ---
    let text = '';
    const ltrSpans = article.querySelectorAll('span[dir="ltr"]');
    for (const span of ltrSpans) {
      const txt = (span.textContent || '').trim();
      if (txt.length > text.length && txt !== authorName && txt !== authorHeadline) {
        text = txt;
      }
    }

    // Skip if no meaningful content
    if (!text && !authorName) continue;

    // --- Timestamp ---
    let createdAt = null;
    const timeEl = article.querySelector('time');
    if (timeEl) {
      const dt = timeEl.getAttribute('datetime');
      if (dt) createdAt = dt;
    }

    // --- Reaction count ---
    let reactionCount = 0;
    const articleText = article.textContent || '';
    const likesMatch = articleText.match(/(\\d[\\d,]*)\\s+reactions?/i);
    if (likesMatch) {
      reactionCount = parseInt(likesMatch[1].replace(/,/g, ''), 10) || 0;
    }

    comments.push({
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
// Wait for post detail to load
// ---------------------------------------------------------------------------

/**
 * Poll the DOM until the post detail page has rendered.  The page is
 * considered ready when an author link and at least one `span[dir="ltr"]`
 * are present.
 */
async function waitForPostLoad(
  client: CDPClient,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate<boolean>(`(() => {
      const authorLink = document.querySelector('a[href*="/in/"], a[href*="/company/"]');
      if (!authorLink) return false;
      const ltrSpans = document.querySelectorAll('span[dir="ltr"]');
      return ltrSpans.length > 0;
    })()`);
    if (ready) return;
    await delay(500);
  }
  throw new Error(
    "Timed out waiting for post detail to appear in the DOM",
  );
}

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
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
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

    // Extract post metadata from the DOM
    const rawPost = await client.evaluate<RawPostDetail>(SCRAPE_POST_DETAIL_SCRIPT);
    if (!rawPost) {
      throw new Error(
        "Failed to extract post detail from the DOM",
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
    const maxLoadMoreAttempts = 20;
    if (maxComments > 0) {
      for (let attempt = 0; attempt < maxLoadMoreAttempts; attempt++) {
        const currentCount = await client.evaluate<number>(
          `document.querySelectorAll('article').length`,
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
    const limited = maxComments > 0 ? allRaw.slice(0, maxComments) : [];

    const comments: PostComment[] = limited.map((c) => ({
      commentUrn: null,
      authorName: c.authorName,
      authorHeadline: c.authorHeadline,
      authorPublicId: c.authorPublicId,
      text: c.text,
      createdAt: parseTimestamp(c.createdAt),
      reactionCount: c.reactionCount,
    }));

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
