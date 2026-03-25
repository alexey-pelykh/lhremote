// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { FeedPost } from "../types/feed.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
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
  urn: string;
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
 * `Runtime.evaluate`.  Returns an array of {@link RawDomPost} objects.
 *
 * The script is intentionally a single IIFE string so it can be sent
 * verbatim to the target without any transpilation.
 */
/** @internal Exported for reuse by search-posts. */
export const SCRAPE_FEED_SCRIPT = `(() => {
  const posts = [];
  const seen = new Set();

  // Find all feed update links — each one identifies a post
  const links = document.querySelectorAll('a[href*="/feed/update/urn:li:"]');

  for (const link of links) {
    const match = link.href.match(/\\/feed\\/update\\/(urn:li:[^/]+)/);
    if (!match) continue;
    const urn = decodeURIComponent(match[1]);
    if (seen.has(urn)) continue;
    seen.add(urn);

    // Walk up to find the post container.  LinkedIn wraps each feed item in
    // a container that is a direct child of the feed list.  We climb until
    // we find an element whose parent is the main feed container or we hit
    // a reasonable depth limit.
    let container = link;
    for (let i = 0; i < 20; i++) {
      const parent = container.parentElement;
      if (!parent || parent.tagName === 'MAIN' || parent.tagName === 'BODY') break;
      container = parent;
      // Stop at data-urn boundary (LinkedIn sometimes annotates feed items)
      if (container.hasAttribute('data-urn')) break;
      // Stop if we've reached a large enough container
      if (container.offsetHeight > 150) {
        // Check if this looks like a feed item wrapper (has sibling feed items)
        const siblings = container.parentElement?.children;
        if (siblings && siblings.length > 1) break;
      }
    }

    // --- Author info ---
    // Author profile links are typically /in/slug or /company/slug
    let authorName = null;
    let authorHeadline = null;
    let authorProfileUrl = null;

    const authorLink = container.querySelector(
      'a[href*="/in/"], a[href*="/company/"]'
    );
    if (authorLink) {
      authorProfileUrl = authorLink.href.split('?')[0] || null;
      // The author name is usually the first meaningful text in the header area
      const nameEl = authorLink.querySelector('span[dir="ltr"], span[aria-hidden="true"]')
        || authorLink;
      const rawName = (nameEl.textContent || '').trim();
      authorName = rawName || null;
    }

    // Author headline: typically a secondary line near the author name
    // Look for a text element that follows the author link area
    const headerSpans = container.querySelectorAll('span.t-12, span.t-normal, span[class*="subtitle"]');
    for (const span of headerSpans) {
      const txt = (span.textContent || '').trim();
      // Skip timestamps and empty strings
      if (txt && !txt.match(/^\\d+[smhdw]$/) && txt.length > 3 && txt !== authorName) {
        authorHeadline = txt;
        break;
      }
    }

    // --- Post text ---
    let text = null;
    const commentaryEl = container.querySelector(
      'span[dir="ltr"].break-words, div.feed-shared-update-v2__commentary, div[class*="update-components-text"]'
    );
    if (commentaryEl) {
      text = (commentaryEl.textContent || '').trim() || null;
    }

    // --- Media type ---
    let mediaType = null;
    if (container.querySelector('video, div[class*="video"]')) {
      mediaType = 'video';
    } else if (container.querySelector('img.feed-shared-image__image, div[class*="image-component"], img[class*="update-components-image"]')) {
      mediaType = 'image';
    } else if (container.querySelector('article, a[class*="article"], div[class*="article"]')) {
      mediaType = 'article';
    } else if (container.querySelector('div[class*="document"]')) {
      mediaType = 'document';
    }

    // --- Engagement counts ---
    const containerText = container.textContent || '';

    function parseCount(pattern) {
      const m = containerText.match(pattern);
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
    const timeEl = container.querySelector('time');
    if (timeEl) {
      const dt = timeEl.getAttribute('datetime');
      if (dt) {
        timestamp = dt;
      }
    }
    if (!timestamp) {
      // Look for relative time text like "52m", "16h", "2d", "1w"
      const timeMatch = containerText.match(/(?:^|\\s)(\\d+[smhdw])(?:\\s|$|\\u00B7|\\xB7)/);
      if (timeMatch) {
        timestamp = timeMatch[1];
      }
    }

    posts.push({
      urn: urn,
      url: 'https://www.linkedin.com/feed/update/' + urn + '/',
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
    urn: r.urn,
    url: r.url ?? buildPostUrl(r.urn),
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

/** @internal Exported for reuse by search-posts. */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** @internal Exported for reuse by search-posts. */
export async function scrollFeed(client: CDPClient): Promise<void> {
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: 300,
    y: 400,
    deltaX: 0,
    deltaY: 800,
  });
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
    const count = await client.evaluate<number>(
      `document.querySelectorAll('a[href*="/feed/update/urn:li:"]').length`,
    );
    if (count > 0) return;
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
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
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
    const cursorUrn = cursor;

    for (let scroll = 0; scroll <= maxScrollAttempts; scroll++) {
      const scraped = await client.evaluate<RawDomPost[]>(SCRAPE_FEED_SCRIPT);
      allPosts = scraped ?? [];

      // Determine which posts to return
      let startIdx = 0;
      if (cursorUrn) {
        const cursorIdx = allPosts.findIndex((p) => p.urn === cursorUrn);
        if (cursorIdx >= 0) {
          startIdx = cursorIdx + 1;
        }
      }

      const available = allPosts.length - startIdx;
      if (available >= count) break;

      // No new posts appeared after scroll — stop
      if (allPosts.length === previousCount && scroll > 0) break;
      previousCount = allPosts.length;

      // Scroll to load more
      if (scroll < maxScrollAttempts) {
        await scrollFeed(client);
        await delay(1500);
      }
    }

    // Slice the result window
    let startIdx = 0;
    if (cursorUrn) {
      const cursorIdx = allPosts.findIndex((p) => p.urn === cursorUrn);
      if (cursorIdx >= 0) {
        startIdx = cursorIdx + 1;
      }
    }

    const window = allPosts.slice(startIdx, startIdx + count);
    const posts = mapRawPosts(window);

    // Determine next cursor
    const hasMore = startIdx + count < allPosts.length;
    const lastPost = window[window.length - 1];
    const nextCursor = hasMore && lastPost ? lastPost.urn : null;

    return { posts, nextCursor };
  } finally {
    client.disconnect();
  }
}
