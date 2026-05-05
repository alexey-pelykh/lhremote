// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import type { PostStats } from "../types/post-analytics.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { waitForPostLoad } from "../cdp/wait-for-post-load.js";
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
// Raw shape returned by the in-page scraping script
// ---------------------------------------------------------------------------

interface RawPostStats {
  reactionCount: number;
  commentCount: number;
  shareCount: number;
}

// ---------------------------------------------------------------------------
// In-page DOM scraping script
// ---------------------------------------------------------------------------

/**
 * JavaScript source evaluated inside the LinkedIn post detail page to
 * extract engagement statistics from the rendered DOM.
 *
 * The post detail page renders engagement counts as text content
 * (e.g. "42 reactions", "5 comments", "3 reposts").  The script
 * searches the page body text for these patterns.
 */
const SCRAPE_POST_STATS_SCRIPT = `(() => {
  let reactionCount = 0;
  let commentCount = 0;
  let shareCount = 0;

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

  return { reactionCount, commentCount, shareCount };
})()`;

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

    // Extract engagement stats from the DOM
    const raw = await client.evaluate<RawPostStats>(SCRAPE_POST_STATS_SCRIPT);
    if (!raw) {
      throw new Error(
        "Failed to extract post stats from the DOM",
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
