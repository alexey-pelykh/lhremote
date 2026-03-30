// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import type { FeedPost } from "../types/feed.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import type { ConnectionOptions } from "./types.js";
import { navigateAwayIf } from "./navigate-away.js";
import { randomDelay, randomBetween, maybeHesitate } from "../utils/delay.js";
import { humanizedScrollToByIndex } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import {
  type RawDomPost,
  mapRawPosts,
  scrollFeed,
  delay,
} from "./get-feed.js";

/**
 * Input for the get-profile-activity operation.
 */
export interface GetProfileActivityInput extends ConnectionOptions {
  /** LinkedIn profile public ID or full profile URL. */
  readonly profile: string;
  /** Number of posts to return per page (default: 10). */
  readonly count?: number | undefined;
  /** Cursor token from a previous get-profile-activity call for the next page. */
  readonly cursor?: string | undefined;
  /** Optional humanized mouse for natural cursor movement and scrolling. */
  readonly mouse?: HumanizedMouse | null | undefined;
}

/**
 * Output from the get-profile-activity operation.
 */
export interface GetProfileActivityOutput {
  /** Resolved profile public ID. */
  readonly profilePublicId: string;
  /** List of posts from the profile. */
  readonly posts: FeedPost[];
  /** Cursor token for retrieving the next page, or null if no more pages. */
  readonly nextCursor: string | null;
}

/** Regex to extract the public ID from a LinkedIn profile URL. */
const LINKEDIN_PROFILE_RE = /linkedin\.com\/in\/([^/?#]+)/;

/**
 * Extract a LinkedIn public profile ID from a URL or bare identifier.
 *
 * Accepts:
 * - Full URL: `https://www.linkedin.com/in/johndoe`
 * - Bare public ID: `johndoe`
 *
 * @returns The decoded public ID.
 */
export function extractProfileId(input: string): string {
  const match = LINKEDIN_PROFILE_RE.exec(input);
  if (match?.[1]) {
    return decodeURIComponent(match[1]);
  }

  // Treat as bare public ID if it doesn't look like a URL
  if (input.length > 0 && !input.includes("/") && !input.includes(":")) {
    return input;
  }

  throw new Error(
    `Cannot extract profile ID from: ${input}. ` +
      "Expected a LinkedIn profile URL (https://www.linkedin.com/in/<id>) or a bare public ID.",
  );
}

// ---------------------------------------------------------------------------
// Activity-page-specific DOM scraping
// ---------------------------------------------------------------------------

/**
 * JavaScript evaluated inside the LinkedIn profile activity page.
 *
 * The activity page uses Ember.js rendering with `div[role="article"]`
 * containers and stable class names (unlike the SSR main feed).
 * Each post has a three-dot menu button matching
 * `button[aria-label^="Open control menu"]`.
 */
const SCRAPE_ACTIVITY_POSTS_SCRIPT = `(() => {
  const posts = [];

  const articles = document.querySelectorAll('div[role="article"]');
  for (const item of articles) {
    if (item.offsetHeight < 100) continue;

    const menuBtn = item.querySelector('button[aria-label^="Open control menu"]');
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
 * Wait for the profile activity page to render posts.
 * Polls for `div[role="article"]` elements with menu buttons.
 */
async function waitForActivityLoad(
  client: CDPClient,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate<boolean>(`(() => {
      const articles = document.querySelectorAll('div[role="article"]');
      for (const a of articles) {
        if (a.querySelector('button[aria-label^="Open control menu"]')) {
          return true;
        }
      }
      return false;
    })()`);
    if (ready) return;
    await delay(500);
  }
  throw new Error(
    "Timed out waiting for activity posts to appear in the DOM",
  );
}

/** CSS selector for activity post menu buttons. */
const ACTIVITY_MENU_BUTTON_SELECTOR =
  'div[role="article"] button[aria-label^="Open control menu"]';

/**
 * Capture the post URL for a single activity post by opening its
 * three-dot menu and clicking "Copy link to post".
 *
 * Requires the clipboard interceptor to be installed beforehand.
 *
 * @returns The post URL (query params stripped) or `null` if capture failed.
 */
async function captureActivityPostUrl(
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
    await humanizedScrollToByIndex(client, ACTIVITY_MENU_BUTTON_SELECTOR, postIndex, mouse);

    // Click the menu button
    const clicked = await client.evaluate<boolean>(`(() => {
      const btns = document.querySelectorAll(
        ${JSON.stringify(ACTIVITY_MENU_BUTTON_SELECTOR)}
      );
      const btn = btns[${postIndex}];
      if (!btn) return false;
      btn.click();
      return true;
    })()`);

    if (!clicked) return null; // No menu button — structural, retrying won't help

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

    if (postUrl) {
      // Strip query parameters
      return postUrl.split("?")[0] ?? postUrl;
    }

    // Dismiss any open menu before retrying
    await client.evaluate(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    })()`);
    await randomDelay(300, 500);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main operation
// ---------------------------------------------------------------------------

/**
 * Retrieve recent posts/activity from a LinkedIn profile.
 *
 * Navigates to the profile's activity page and extracts posts from the
 * rendered DOM.  The activity page uses Ember.js rendering with
 * `div[role="article"]` containers (different from the SSR main feed).
 * Supports cursor-based pagination via scrolling.
 *
 * @param input - Profile identifier, pagination, and CDP connection options.
 * @returns List of posts with a cursor for the next page.
 */
export async function getProfileActivity(
  input: GetProfileActivityInput,
): Promise<GetProfileActivityOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const count = input.count ?? 10;
  const cursor = input.cursor ?? null;

  const profilePublicId = extractProfileId(input.profile);

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
    // Navigate away if already on the activity page to force a fresh load
    await navigateAwayIf(client, "/recent-activity/");

    const activityUrl = `https://www.linkedin.com/in/${encodeURIComponent(profilePublicId)}/recent-activity/all/`;
    await client.navigate(activityUrl);

    // Wait for activity posts to render
    await waitForActivityLoad(client);

    const mouse = input.mouse ?? null;

    // Collect posts — scroll to load more if needed
    const maxScrollAttempts = 10;
    let allPosts: RawDomPost[] = [];
    let previousCount = 0;

    const cursorUrl = cursor;

    for (let scroll = 0; scroll <= maxScrollAttempts; scroll++) {
      const countBeforeScroll = previousCount;
      const scraped =
        await client.evaluate<RawDomPost[]>(SCRAPE_ACTIVITY_POSTS_SCRIPT);
      allPosts = scraped ?? [];

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
    // Install clipboard interceptor (Electron's clipboard API is broken)
    await client.evaluate(
      `navigator.clipboard.writeText = function(text) {
        window.__capturedClipboard = text;
        return Promise.resolve();
      };`,
    );

    for (let i = 0; i < allPosts.length; i++) {
      const post = allPosts[i];
      if (!post) continue;
      if (i > 0) await randomDelay(300, 800); // Inter-post delay
      const url = await captureActivityPostUrl(client, i, mouse);
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

    // Determine next cursor — use last post with a non-null URL
    const hasMore = startIdx + count < allPosts.length;
    let nextCursor: string | null = null;
    if (hasMore) {
      for (let i = window.length - 1; i >= 0; i--) {
        const url = window[i]?.url;
        if (url) {
          nextCursor = url;
          break;
        }
      }
    }

    return { profilePublicId, posts, nextCursor };
  } finally {
    client.disconnect();
  }
}
