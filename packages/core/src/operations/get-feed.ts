// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import type { FeedPost } from "../types/feed.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { humanizedScrollY, humanizedScrollToByIndex, retryInteraction } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { delay as utilsDelay, gaussianDelay, gaussianBetween, maybeHesitate, maybeBreak, simulateReadingTime } from "../utils/delay.js";
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
 * ## Discovery strategy (2026-04 onwards)
 *
 * LinkedIn's SSR feed uses `div[data-testid="mainFeed"]` as the feed
 * list (`role="list"`) and `div[role="listitem"]` for each post.
 * CSS class names are obfuscated hashes (CSS Modules), so the script
 * relies on semantic attributes (`data-testid`, `aria-label`) and
 * structural position within author links.
 *
 * - **Post text**: `[data-testid="expandable-text-box"]` (clone, strip
 *   `expandable-text-button` child, take `textContent`).
 * - **Author name**: menu button `aria-label` prefix strip.
 * - **Author headline**: 3rd `<p>` in the text-bearing author link.
 * - **Timestamp**: last `<p>` matching `\d+[smhdw]` in that link.
 *
 * Post URNs are NOT available in the DOM.  They are extracted in a
 * separate phase by opening each post's three-dot menu, clicking
 * "Copy link to post", and deriving the URN from the captured URL.
 */
const SCRAPE_FEED_POSTS_SCRIPT = `(() => {
  const posts = [];
  if (window.__lhrNextIdx == null) window.__lhrNextIdx = 0;

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

    // --- Discovery tagging ---
    // Tag each listitem with a unique index on first discovery so that
    // posts can be accumulated across scroll iterations despite LinkedIn
    // virtualising off-screen items out of the DOM.  The index value
    // itself isn't consumed by the Node-side logic — it's only used as
    // the DOM attribute payload so that already-seen items can be
    // recognised on subsequent scrapes.
    let _isNew = false;
    if (!item.hasAttribute('data-lhr-idx')) {
      item.setAttribute('data-lhr-idx', String(window.__lhrNextIdx++));
      _isNew = true;
    }

    // --- Author info ---
    let authorName = null;
    let authorHeadline = null;
    let authorProfileUrl = null;
    let timestamp = null;

    const authorLink = item.querySelector('a[href*="/in/"], a[href*="/company/"]');
    if (authorLink) {
      authorProfileUrl = authorLink.href.split('?')[0] || null;
    }

    // Author name: strip known prefix from the menu button's aria-label.
    // The menu button is already validated above (line that sets menuBtn).
    const menuLabel = menuBtn.getAttribute('aria-label') || '';
    authorName = menuLabel.replace('Open control menu for post by ', '') || null;

    // Author headline + timestamp: find the text-bearing second author
    // link.  Each post has two links to the author profile — the first
    // contains only an avatar (<figure>), the second contains <p>
    // elements with name, degree, headline, and timestamp.
    if (authorLink) {
      const authorPath = new URL(authorLink.href).pathname;
      const allLinks = Array.from(item.querySelectorAll('a[href*="' + authorPath + '"]'));
      const textLink = allLinks.find(function(a) { return a.textContent.trim().length > 0; });

      if (textLink) {
        const pEls = Array.from(textLink.querySelectorAll('p'));

        // Timestamp: last <p> matching relative-time pattern (e.g. "18h •")
        for (let i = pEls.length - 1; i >= 0; i--) {
          const txt = pEls[i].textContent.trim();
          if (/^\\d+[smhdw]\\s*/.test(txt)) {
            timestamp = txt.replace(/\\s*[\\u2022\\u00B7]\\s*$/, '').trim();
            pEls.splice(i, 1);
            break;
          }
        }

        // Headline: 3rd <p> (index 2) — after name and connection degree.
        // Company posts may have only 2 <p> elements (name + timestamp),
        // in which case authorHeadline stays null.
        if (pEls.length >= 3) {
          authorHeadline = pEls[2].textContent.trim() || null;
        }
      }
    }

    // --- Post text ---
    // The feed DOM uses data-testid="expandable-text-box" for post body
    // text.  The optional "… more" button is a child of the text box and
    // must be stripped before reading textContent.
    let text = null;
    const textBox = item.querySelector('[data-testid="expandable-text-box"]');
    if (textBox) {
      const clone = textBox.cloneNode(true);
      const moreBtn = clone.querySelector('[data-testid="expandable-text-button"]');
      if (moreBtn) moreBtn.remove();
      text = clone.textContent.trim() || null;
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

    posts.push({
      _isNew: _isNew,
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
  const MAX_ATTEMPTS = 3;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
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

    if (!clicked) return null; // No menu button — structural, retrying won't help

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
    const postUrl =
      await client.evaluate<string | null>(`window.__capturedClipboard`);

    if (postUrl) {
      // Strip query parameters
      return postUrl.split("?")[0] ?? postUrl;
    }

    // Dismiss any open menu before retrying
    await client.evaluate(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    })()`);

    // Escalating retry delays: longer waits on later attempts
    const retryDelays = [
      { mean: 700, stdDev: 200 },
      { mean: 1_200, stdDev: 400 },
      { mean: 2_500, stdDev: 800 },
    ] as const;
    const rd = retryDelays[attempt] ?? retryDelays[2];
    await gaussianDelay(rd.mean, rd.stdDev, rd.mean * 0.5, rd.mean * 1.5);

    // 50% chance of a small "confusion" scroll to reset visual state
    if (Math.random() < 0.5) {
      const scrollDist = Math.round(gaussianBetween(75, 15, 50, 100));
      const dir = Math.random() < 0.5 ? -1 : 1;
      await humanizedScrollY(client, scrollDist * dir, 300, 400, mouse);
      await gaussianDelay(300, 100, 150, 500);
    }
  }

  return null;
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
    url: r.url ?? null,
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
  const distance = Math.round(gaussianBetween(800, 100, 600, 1_000));
  const x = Math.round(gaussianBetween(350, 100, 150, 550));
  const y = Math.round(gaussianBetween(400, 80, 250, 550));
  await humanizedScrollY(client, distance, x, y, mouse);
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

    // Collect posts — scroll to load more if needed.
    //
    // LinkedIn's main feed virtualises off-screen posts out of the DOM,
    // so each point-in-time scrape only sees ~8-13 items.  To accumulate
    // beyond that cap we tag discovered listitems with `data-lhr-idx`
    // and interleave URL extraction with scrolling so that each post's
    // URL is captured while the element is still visible.
    //
    // The target is counted in URL-bearing posts only (`seenUrls.size`).
    // Posts whose URL extraction failed are still accumulated for
    // completeness but don't count toward the target — otherwise a run
    // of transient failures could make the loop exit with a window of
    // null-URL posts and no usable cursor.
    //
    // We need `count` posts plus one extra so the hasMore check has a
    // post beyond the result window.  Cursor calls use `count * 2 + 1`:
    // up to `count` posts may be consumed locating the cursor, then
    // `count` more for the next page, plus one for hasMore.
    const maxScrollAttempts = 10;
    const allPosts: RawDomPost[] = [];
    const seenUrls = new Set<string>();
    const accumulationTarget = cursor ? count * 2 + 1 : count + 1;
    let previousUrlCount = 0;

    type TaggedPost = RawDomPost & { _isNew: boolean };

    // If resuming with a cursor, we need to scroll past already-seen posts
    const cursorUrl = cursor;

    // Install the clipboard interceptor before the scroll loop so that
    // URL extraction can happen inside each iteration.
    await installClipboardInterceptor(client);

    for (let scroll = 0; scroll <= maxScrollAttempts; scroll++) {
      const countBefore = allPosts.length;

      // Scrape visible posts — the script tags each listitem with a
      // discovery index and reports which items are newly discovered.
      const scraped = await client.evaluate<TaggedPost[]>(SCRAPE_FEED_POSTS_SCRIPT);
      const batch = scraped ?? [];

      // Extract URLs for newly discovered posts while they are visible.
      // `domIdx` is the position within the current batch which matches
      // the DOM order of visible menu buttons.
      //
      // To avoid extracting URLs for far more posts than needed (each
      // extraction opens the three-dot menu — ~1-2 s per post), we stop
      // once we have enough URL-bearing posts.
      let extractedInBatch = 0;
      for (let domIdx = 0; domIdx < batch.length; domIdx++) {
        const post = batch[domIdx];
        if (!post?._isNew) continue;

        // Stop extracting once we have enough URL-bearing posts
        if (seenUrls.size >= accumulationTarget) break;

        if (extractedInBatch > 0) await gaussianDelay(550, 125, 300, 800);
        await maybeBreak();

        const url = await retryInteraction(
          () => capturePostUrl(client, domIdx, mouse),
        );
        if (url) {
          post.url = url;
        }
        extractedInBatch++;

        // Accumulate the post (dedup by URL when available)
        if (post.url) {
          if (!seenUrls.has(post.url)) {
            seenUrls.add(post.url);
            allPosts.push(post);
          }
        } else {
          // URL extraction failed — include for completeness but don't
          // count toward accumulationTarget (see comment above).
          allPosts.push(post);
        }
      }

      // Enough URL-bearing posts accumulated?
      if (seenUrls.size >= accumulationTarget) break;

      // No new URL-bearing posts after scroll — stop
      if (seenUrls.size === previousUrlCount && scroll > 0) break;

      const newPostCount = allPosts.length - countBefore;
      previousUrlCount = seenUrls.size;

      // Scroll to load more
      if (scroll < maxScrollAttempts) {
        await scrollFeed(client, mouse);

        // Progressive session fatigue: delays increase with each scroll
        const fatigueMultiplier = 1 + scroll * 0.1;
        // Scale delay by newly visible content volume
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

    // Determine next cursor — scan backwards for the nearest post with a
    // non-null URL so that a single failed URL extraction doesn't block
    // pagination when more posts are available.
    const hasMore = startIdx + count < allPosts.length;
    let nextCursor: string | null = null;
    if (hasMore) {
      for (let i = window.length - 1; i >= 0; i--) {
        const postUrl = window[i]?.url;
        if (postUrl) {
          nextCursor = postUrl;
          break;
        }
      }
    }

    await gaussianDelay(800, 300, 300, 1_800); // Post-action dwell
    return { posts, nextCursor };
  } finally {
    client.disconnect();
  }
}
