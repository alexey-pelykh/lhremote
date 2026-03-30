// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import type { FeedPost } from "../types/feed.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { humanizedScrollY, humanizedScrollToByIndex } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { delay as utilsDelay, randomDelay, randomBetween, maybeHesitate } from "../utils/delay.js";
import type { ConnectionOptions } from "./types.js";
import { navigateAwayIf } from "./navigate-away.js";

/**
 * Input for the get-feed operation.
 */
export interface GetFeedInput extends ConnectionOptions {
  /** Number of posts per page (default: 10). */
  readonly count?: number | undefined;
  /** Cursor token from a previous get-feed call for the next page. */
  readonly cursor?: string | undefined;
  /** Optional humanized mouse for natural cursor movement and scrolling. */
  readonly mouse?: HumanizedMouse | null | undefined;
}

/**
 * Output from the get-feed operation.
 */
export interface GetFeedOutput {
  /** Feed posts for the current page. */
  readonly posts: FeedPost[];
  /** Cursor token for retrieving the next page, or null if no more pages. */
  readonly nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Raw post shape returned by the in-page scraping script
// ---------------------------------------------------------------------------

/** @internal Exported for reuse by search-posts. */
export interface RawDomPost {
  url: string | null;
  authorName: string | null;
  authorHeadline: string | null;
  authorProfileUrl: string | null;
  text: string | null;
  mediaType: string | null;
  reactionCount: number;
  commentCount: number;
  shareCount: number;
  timestamp: string | null;
}

// ---------------------------------------------------------------------------
// In-page DOM scraping script
// ---------------------------------------------------------------------------

/**
 * JavaScript source evaluated inside the LinkedIn page context via
 * `Runtime.evaluate`.  Returns an array of {@link RawDomPost} objects
 * (without URNs — those are extracted separately via the three-dot menu).
 *
 * ## Discovery strategy (2026-03 onwards)
 *
 * LinkedIn's SSR feed uses `div[data-testid="mainFeed"]` as the feed
 * list (`role="list"`) and `div[role="listitem"]` for each post.
 * CSS class names are obfuscated hashes (CSS Modules), so the script
 * relies on semantic attributes and structural heuristics.
 *
 * Post URNs are NOT available in the DOM.  They are extracted in a
 * separate phase by opening each post's three-dot menu, clicking
 * "Copy link to post", and deriving the URN from the captured URL.
 */
const SCRAPE_FEED_POSTS_SCRIPT = `(() => {
  const posts = [];

  // --- Step 1: Find the feed list via data-testid ---
  const feedList = document.querySelector('[data-testid="mainFeed"]');
  if (!feedList) return posts;

  // --- Step 2: Iterate listitem children ---
  const items = feedList.querySelectorAll('div[role="listitem"]');
  for (const wrapper of items) {
    // The listitem wraps the actual post content in nested divs.
    // Some listitems may be zero-height (virtualized/hidden) or
    // non-post items (composer, suggestions).
    const item = wrapper;
    if (item.offsetHeight < 100) continue;

    // Detect real posts: must have a three-dot menu button
    const menuBtn = item.querySelector('button[aria-label^="Open control menu for post"]');
    if (!menuBtn) continue;

    // --- Author info ---
    let authorName = null;
    let authorHeadline = null;
    let authorProfileUrl = null;

    const authorLink = item.querySelector('a[href*="/in/"], a[href*="/company/"]');
    if (authorLink) {
      authorProfileUrl = authorLink.href.split('?')[0] || null;
      const nameEl = authorLink.querySelector('span[dir="ltr"], span[aria-hidden="true"]')
        || authorLink;
      const rawName = (nameEl.textContent || '').trim();
      authorName = rawName || null;
    }

    // Author headline: look for a short descriptive text near the author.
    const allSpans = item.querySelectorAll('span');
    for (const span of allSpans) {
      const txt = (span.textContent || '').trim();
      if (
        txt &&
        txt.length > 5 &&
        txt.length < 200 &&
        txt !== authorName &&
        !txt.match(/^\\d+[smhdw]$/) &&
        !txt.match(/^\\d[\\d,]*\\s+(reactions?|comments?|reposts?|likes?)$/i) &&
        !txt.match(/^Follow$|^Promoted$/i)
      ) {
        authorHeadline = txt;
        break;
      }
    }

    // --- Post text ---
    let text = null;
    const ltrSpans = item.querySelectorAll('span[dir="ltr"]');
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

    // --- Media type ---
    let mediaType = null;
    if (item.querySelector('video')) {
      mediaType = 'video';
    } else if (item.querySelector('img[src*="media.licdn.com"]')) {
      const imgs = item.querySelectorAll('img[src*="media.licdn.com"]');
      for (const img of imgs) {
        if (img.offsetHeight > 100) { mediaType = 'image'; break; }
      }
    }

    // --- Engagement counts ---
    const itemText = item.textContent || '';

    function parseCount(pattern) {
      const m = itemText.match(pattern);
      if (!m) return 0;
      const raw = m[1].replace(/,/g, '');
      const num = parseInt(raw, 10);
      return isNaN(num) ? 0 : num;
    }

    const reactionCount = parseCount(/(\\d[\\d,]*)\\s+reactions?/i);
    const commentCount = parseCount(/(\\d[\\d,]*)\\s+comments?/i);
    const shareCount = parseCount(/(\\d[\\d,]*)\\s+reposts?/i);

    // --- Timestamp ---
    let timestamp = null;
    const timeEl = item.querySelector('time');
    if (timeEl) {
      const dt = timeEl.getAttribute('datetime');
      if (dt) timestamp = dt;
    }
    if (!timestamp) {
      const timeMatch = itemText.match(/(?:^|\\s)(\\d+[smhdw])(?:\\s|$|\\u00B7|\\xB7)/);
      if (timeMatch) timestamp = timeMatch[1];
    }

    posts.push({
      url: null,
      authorName: authorName,
      authorHeadline: authorHeadline,
      authorProfileUrl: authorProfileUrl,
      text: text,
      mediaType: mediaType,
      reactionCount: reactionCount,
      commentCount: commentCount,
      shareCount: shareCount,
      timestamp: timestamp,
    });
  }

  return posts;
})()`;

/**
 * Legacy scraping script using structural heuristics to find the feed
 * container.  Used by search-posts which navigates to search result
 * pages where `data-testid="mainFeed"` is not present.
 *
 * @internal Exported for reuse by search-posts.
 */
export { SCRAPE_FEED_POSTS_SCRIPT as SCRAPE_FEED_SCRIPT };

// ---------------------------------------------------------------------------
// URL capture via three-dot menu → "Copy link to post"
// ---------------------------------------------------------------------------

/** CSS selector for feed post menu buttons. */
const FEED_MENU_BUTTON_SELECTOR =
  '[data-testid="mainFeed"] div[role="listitem"] button[aria-label^="Open control menu for post"]';

/**
 * Capture the post URL for a single feed item by opening its three-dot
 * menu and clicking "Copy link to post".
 *
 * Requires the clipboard interceptor to be installed beforehand via
 * {@link installClipboardInterceptor}.
 *
 * @returns The post URL (query params stripped) or `null` if capture failed.
 */
async function capturePostUrl(
  client: CDPClient,
  postIndex: number,
  mouse?: HumanizedMouse | null,
): Promise<string | null> {
  await maybeHesitate(); // Probabilistic pause before menu interaction

  // Reset clipboard capture
  await client.evaluate(`window.__capturedClipboard = null;`);

  // Scroll the menu button into view (humanized when mouse available)
  await humanizedScrollToByIndex(client, FEED_MENU_BUTTON_SELECTOR, postIndex, mouse);

  // Click the menu button
  const clicked = await client.evaluate<boolean>(`(() => {
    const btns = document.querySelectorAll(
      ${JSON.stringify(FEED_MENU_BUTTON_SELECTOR)}
    );
    const btn = btns[${postIndex}];
    if (!btn) return false;
    btn.click();
    return true;
  })()`);

  if (!clicked) return null;

  await randomDelay(500, 900);

  // Click "Copy link to post" menu item
  await client.evaluate(`(() => {
    for (const el of document.querySelectorAll('[role="menuitem"]')) {
      if (el.textContent.trim() === 'Copy link to post') {
        el.click();
        return;
      }
    }
  })()`);

  await randomDelay(400, 700);

  // Read captured URL
  const postUrl =
    await client.evaluate<string | null>(`window.__capturedClipboard`);

  if (!postUrl) return null;

  // Strip query parameters
  return postUrl.split("?")[0] ?? postUrl;
}

/**
 * Install a clipboard interceptor that captures `navigator.clipboard.writeText`
 * calls into `window.__capturedClipboard`.  Required because Electron's
 * clipboard API is broken (readText returns `{}`).
 */
async function installClipboardInterceptor(client: CDPClient): Promise<void> {
  await client.evaluate(
    `navigator.clipboard.writeText = function(text) {
      window.__capturedClipboard = text;
      return Promise.resolve();
    };`,
  );
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract hashtags from post text.
 */
export function extractHashtags(text: string | null): string[] {
  if (!text) return [];
  const matches = text.match(/#[\w\u00C0-\u024F]+/g);
  return matches ? [...new Set(matches.map((t) => t.slice(1)))] : [];
}

/**
 * Parse a relative timestamp string (e.g. "52m", "16h", "2d", "1w") or an
 * ISO date into epoch milliseconds.  Returns null for unrecognised formats.
 */
export function parseTimestamp(raw: string | null): number | null {
  if (!raw) return null;

  // ISO datetime
  const asDate = Date.parse(raw);
  if (!isNaN(asDate)) return asDate;

  // Relative time: Ns, Nm, Nh, Nd, Nw
  const match = raw.match(/^(\d+)([smhdw])$/);
  if (!match) return null;

  const value = parseInt(match[1] ?? "0", 10);
  const unit = match[2] ?? "";
  const now = Date.now();

  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };

  return now - value * (multipliers[unit] ?? 0);
}

/**
 * Build a LinkedIn post URL from an activity URN.
 */
/** @internal Exported for reuse by search-posts. */
export function buildPostUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

/**
 * Convert raw DOM-scraped posts into normalised FeedPost entries.
 */
/** @internal Exported for reuse by search-posts. */
export function mapRawPosts(raw: RawDomPost[]): FeedPost[] {
  return raw.map((r) => ({
    url: r.url ?? "",
    authorName: r.authorName,
    authorHeadline: r.authorHeadline,
    authorProfileUrl: r.authorProfileUrl,
    authorPublicId: null,
    text: r.text,
    mediaType: r.mediaType,
    reactionCount: r.reactionCount,
    commentCount: r.commentCount,
    shareCount: r.shareCount,
    timestamp: parseTimestamp(r.timestamp),
    hashtags: extractHashtags(r.text),
  }));
}

// ---------------------------------------------------------------------------
// Scroll helper
// ---------------------------------------------------------------------------

/** @internal Exported for reuse by other operations. */
export const delay = utilsDelay;

/**
 * Scroll the feed down by a randomised viewport-like distance.
 *
 * The distance varies between 600–1000 px per scroll to avoid the
 * detection signal of a perfectly uniform scroll cadence.
 *
 * When a {@link HumanizedMouse} is provided, scrolling uses incremental
 * mouse-wheel strokes (150 px / 25 ms) that mimic a physical scroll
 * wheel.  Falls back to a single CDP `mouseWheel` event otherwise.
 *
 * @internal Exported for reuse by search-posts.
 */
export async function scrollFeed(
  client: CDPClient,
  mouse?: HumanizedMouse | null,
): Promise<void> {
  const distance = Math.round(randomBetween(600, 1_000));
  await humanizedScrollY(client, distance, 300, 400, mouse);
}

// ---------------------------------------------------------------------------
// Wait for feed to load
// ---------------------------------------------------------------------------

/** @internal Exported for reuse by search-posts. */
export async function waitForFeedLoad(
  client: CDPClient,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate<boolean>(`(() => {
      const feed = document.querySelector('[data-testid="mainFeed"]');
      if (!feed) return false;
      const items = feed.querySelectorAll('div[role="listitem"]');
      // Ready when at least one listitem has a post menu button
      for (const item of items) {
        if (item.querySelector('button[aria-label^="Open control menu for post"]')) {
          return true;
        }
      }
      return false;
    })()`);
    if (ready) return;
    await delay(500);
  }
  throw new Error(
    "Timed out waiting for feed posts to appear in the DOM",
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the LinkedIn home feed and return structured post data.
 *
 * Navigates to the feed page and extracts posts from the rendered DOM.
 * Supports cursor-based pagination: the first call returns the first page;
 * pass the returned `nextCursor` in subsequent calls to retrieve additional
 * pages via scroll + re-scrape.
 *
 * @param input - Pagination parameters and CDP connection options.
 * @returns Feed posts with a cursor for the next page.
 */
export async function getFeed(
  input: GetFeedInput,
): Promise<GetFeedOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const count = input.count ?? 10;
  const cursor = input.cursor ?? null;

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
    const mouse = input.mouse ?? null;

    // Navigate away if already on the feed page to force a fresh load
    await navigateAwayIf(client, "/feed");
    await client.navigate("https://www.linkedin.com/feed/");

    // Wait for the initial feed content to render
    await waitForFeedLoad(client);

    // Collect posts — scroll to load more if needed
    const maxScrollAttempts = 10;
    let allPosts: RawDomPost[] = [];
    let previousCount = 0;

    // If resuming with a cursor, we need to scroll past already-seen posts
    const cursorUrl = cursor;

    for (let scroll = 0; scroll <= maxScrollAttempts; scroll++) {
      const countBeforeScroll = previousCount;
      const scraped = await client.evaluate<RawDomPost[]>(SCRAPE_FEED_POSTS_SCRIPT);
      allPosts = scraped ?? [];

      // Determine which posts to return
      const available = allPosts.length;
      if (available >= count && !cursorUrl) break;

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
          newPostCount * randomBetween(200, 500),
          3_000,
        );
        await randomDelay(
          1_200 * fatigueMultiplier + contentBonus,
          1_800 * fatigueMultiplier + contentBonus,
        );
      }
    }

    // --- URL extraction phase ---
    // Open each post's three-dot menu, click "Copy link to post", and
    // derive the URN from the captured URL.  This populates the urn/url
    // fields that the scrape script left null.
    await installClipboardInterceptor(client);

    for (let i = 0; i < allPosts.length; i++) {
      const post = allPosts[i];
      if (!post) continue;
      if (i > 0) await randomDelay(300, 800); // Inter-post delay
      const url = await capturePostUrl(client, i, mouse);
      if (url) {
        post.url = url;
      }
    }

    // Slice the result window
    let startIdx = 0;
    if (cursorUrl) {
      const cursorIdx = allPosts.findIndex((p) => p.url === cursorUrl);
      if (cursorIdx >= 0) {
        startIdx = cursorIdx + 1;
      }
    }

    const window = allPosts.slice(startIdx, startIdx + count);
    const posts = mapRawPosts(window);

    // Determine next cursor
    const hasMore = startIdx + count < allPosts.length;
    const lastPost = window[window.length - 1];
    const nextCursor = hasMore && lastPost ? lastPost.url : null;

    return { posts, nextCursor };
  } finally {
    client.disconnect();
  }
}
