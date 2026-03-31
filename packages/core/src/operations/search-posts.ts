// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import type { FeedPost } from "../types/feed.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import type { ConnectionOptions } from "./types.js";
import { navigateAwayIf } from "./navigate-away.js";
import { gaussianDelay, gaussianBetween, maybeHesitate } from "../utils/delay.js";
import { humanizedScrollToByIndex } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import {
  type RawDomPost,
  mapRawPosts,
  scrollFeed,
  delay,
} from "./get-feed.js";

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
// Search-specific DOM scraping script
// ---------------------------------------------------------------------------

/**
 * JavaScript evaluated inside the LinkedIn search results page.  Returns
 * an array of {@link RawDomPost} objects.
 *
 * Search result items are `div[role="listitem"]` elements (NOT wrapped
 * in `data-testid="mainFeed"` like the feed page).  URNs/URLs are NOT
 * exposed inline — they are extracted in a subsequent phase by opening
 * each post's three-dot menu and clicking "Copy link to post", which
 * writes the URL to `navigator.clipboard.writeText`.
 */
const SCRAPE_SEARCH_RESULTS_SCRIPT = `(() => {
  const posts = [];

  // --- Strategy 1: div[role="listitem"] search results (no mainFeed wrapper) ---
  const searchItems = document.querySelectorAll('div[role="listitem"]');
  const isSearchPage = searchItems.length > 0
    && !document.querySelector('[data-testid="mainFeed"]');
  if (isSearchPage) {
    for (const card of searchItems) {
      if (card.offsetHeight < 100) continue;
      const menuBtn = card.querySelector('button[aria-label^="Open control menu for post"]');
      if (!menuBtn) continue;

      // URL extracted via three-dot menu

      let authorName = null;
      let authorHeadline = null;
      let authorProfileUrl = null;

      const authorLink = card.querySelector('a[href*="/in/"], a[href*="/company/"]');
      if (authorLink) {
        authorProfileUrl = authorLink.href.split('?')[0] || null;
        const nameEl = authorLink.querySelector('span[dir="ltr"], span[aria-hidden="true"]')
          || authorLink;
        const rawName = (nameEl.textContent || '').trim();
        authorName = rawName || null;
      }

      const allSpans = card.querySelectorAll('span');
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

      let text = null;
      const ltrSpans = card.querySelectorAll('span[dir="ltr"]');
      let longestText = '';
      for (const span of ltrSpans) {
        const txt = (span.textContent || '').trim();
        if (txt.length > longestText.length && txt !== authorName && txt !== authorHeadline) {
          longestText = txt;
        }
      }
      if (longestText.length > 20) text = longestText;

      let mediaType = null;
      if (card.querySelector('video')) {
        mediaType = 'video';
      } else if (card.querySelector('img[src*="media.licdn.com"]')) {
        const imgs = card.querySelectorAll('img[src*="media.licdn.com"]');
        for (const img of imgs) {
          if (img.offsetHeight > 100) { mediaType = 'image'; break; }
        }
      }

      const cardText = card.textContent || '';
      function parseCount(pattern) {
        const m = cardText.match(pattern);
        if (!m) return 0;
        const raw = m[1].replace(/,/g, '');
        const num = parseInt(raw, 10);
        return isNaN(num) ? 0 : num;
      }

      const reactionCount = parseCount(/(\\d[\\d,]*)\\s+reactions?/i);
      const commentCount = parseCount(/(\\d[\\d,]*)\\s+comments?/i);
      const shareCount = parseCount(/(\\d[\\d,]*)\\s+reposts?/i);

      let timestamp = null;
      const timeEl = card.querySelector('time');
      if (timeEl) {
        const dt = timeEl.getAttribute('datetime');
        if (dt) timestamp = dt;
      }
      if (!timestamp) {
        const timeMatch = cardText.match(/(?:^|\\s)(\\d+[smhdw])(?:\\s|$|\\u00B7|\\xB7)/);
        if (timeMatch) timestamp = timeMatch[1];
      }

      posts.push({
        url: null,
        authorName,
        authorHeadline,
        authorProfileUrl,
        text,
        mediaType,
        reactionCount,
        commentCount,
        shareCount,
        timestamp,
      });
    }
    return posts;
  }

  // --- Strategy 2: mainFeed fallback (older LinkedIn renders) ---
  const feedList = document.querySelector('[data-testid="mainFeed"]');
  if (!feedList) return posts;

  const items = feedList.querySelectorAll('div[role="listitem"]');
  for (const item of items) {
    if (item.offsetHeight < 100) continue;
    const menuBtn = item.querySelector('button[aria-label^="Open control menu for post"]');
    if (!menuBtn) continue;

    let authorName = null;
    let authorHeadline = null;
    let authorProfileUrl = null;

    const authorLink = item.querySelector('a[href*="/in/"], a[href*="/company/"]');
    if (authorLink) {
      authorProfileUrl = authorLink.href.split('?')[0] || null;
      const nameEl = authorLink.querySelector('span[dir="ltr"], span[aria-hidden="true"]')
        || authorLink;
      authorName = (nameEl.textContent || '').trim() || null;
    }

    const allSpans = item.querySelectorAll('span');
    for (const span of allSpans) {
      const txt = (span.textContent || '').trim();
      if (
        txt && txt.length > 5 && txt.length < 200 &&
        txt !== authorName &&
        !txt.match(/^\\d+[smhdw]$/) &&
        !txt.match(/^\\d[\\d,]*\\s+(reactions?|comments?|reposts?|likes?)$/i) &&
        !txt.match(/^Follow$|^Promoted$/i)
      ) {
        authorHeadline = txt;
        break;
      }
    }

    let text = null;
    const ltrSpans = item.querySelectorAll('span[dir="ltr"]');
    let longestText = '';
    for (const span of ltrSpans) {
      const txt = (span.textContent || '').trim();
      if (txt.length > longestText.length && txt !== authorName && txt !== authorHeadline) {
        longestText = txt;
      }
    }
    if (longestText.length > 20) text = longestText;

    let mediaType = null;
    if (item.querySelector('video')) {
      mediaType = 'video';
    } else if (item.querySelector('img[src*="media.licdn.com"]')) {
      const imgs = item.querySelectorAll('img[src*="media.licdn.com"]');
      for (const img of imgs) {
        if (img.offsetHeight > 100) { mediaType = 'image'; break; }
      }
    }

    const itemText = item.textContent || '';
    function parseCount2(pattern) {
      const m = itemText.match(pattern);
      if (!m) return 0;
      const raw = m[1].replace(/,/g, '');
      const num = parseInt(raw, 10);
      return isNaN(num) ? 0 : num;
    }

    const reactionCount = parseCount2(/(\\d[\\d,]*)\\s+reactions?/i);
    const commentCount = parseCount2(/(\\d[\\d,]*)\\s+comments?/i);
    const shareCount = parseCount2(/(\\d[\\d,]*)\\s+reposts?/i);

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
      authorName,
      authorHeadline,
      authorProfileUrl,
      text,
      mediaType,
      reactionCount,
      commentCount,
      shareCount,
      timestamp,
    });
  }

  return posts;
})()`;

// ---------------------------------------------------------------------------
// Search-specific readiness check
// ---------------------------------------------------------------------------

/**
 * Wait until search results are visible in the DOM.
 *
 * Checks for two possible page structures:
 * 1. `[data-chameleon-result-urn]` — modern search results with inline URNs.
 * 2. `[data-testid="mainFeed"]` with menu buttons — older layout sharing
 *    the feed container.
 *
 * @internal Exported for testing.
 */
export async function waitForSearchResults(
  client: CDPClient,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate<boolean>(`(() => {
      // Search results render as div[role="listitem"] with post menu buttons.
      // Unlike the feed page they are NOT wrapped in data-testid="mainFeed".
      const items = document.querySelectorAll('div[role="listitem"]');
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
    "Timed out waiting for search results to appear in the DOM",
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

    const startIdx = cursor ?? 0;
    if (startIdx < 0) {
      throw new Error(`Invalid cursor ${String(cursor)} — must be a non-negative integer offset`);
    }

    for (let scroll = 0; scroll <= maxScrollAttempts; scroll++) {
      const countBeforeScroll = previousCount;
      const scraped =
        await client.evaluate<RawDomPost[]>(SCRAPE_SEARCH_RESULTS_SCRIPT);
      allPosts = scraped ?? [];

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
      }
    }

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

      const SEARCH_MENU_BUTTON_SELECTOR =
        'div[role="listitem"] button[aria-label^="Open control menu for post"]';

      for (let i = 0; i < allPosts.length; i++) {
        const post = allPosts[i];
        if (!post || post.url) continue;

        if (i > 0) await gaussianDelay(550, 125, 300, 800); // Inter-post delay
        await maybeHesitate(); // Probabilistic pause before menu interaction

        // Reset capture
        await client.evaluate(`window.__capturedClipboard = null;`);

        // Scroll the menu button into view (humanized when mouse available)
        await humanizedScrollToByIndex(client, SEARCH_MENU_BUTTON_SELECTOR, i, mouse);

        // Click the i-th menu button
        const clicked = await client.evaluate<boolean>(`(() => {
          const btns = document.querySelectorAll(
            ${JSON.stringify(SEARCH_MENU_BUTTON_SELECTOR)}
          );
          const btn = btns[${String(i)}];
          if (!btn) return false;
          btn.click();
          return true;
        })()`);
        if (!clicked) continue;

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
          post.url = postUrl.split("?")[0] ?? postUrl;
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
