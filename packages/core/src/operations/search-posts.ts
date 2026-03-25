// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { FeedPost } from "../types/feed.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";
import { navigateAwayIf } from "./navigate-away.js";
import {
  type RawDomPost,
  SCRAPE_FEED_SCRIPT,
  mapRawPosts,
  scrollFeed,
  waitForFeedLoad,
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
  /** Cursor token from a previous search-posts call for the next page. */
  readonly cursor?: string | undefined;
}

/**
 * Output from the search-posts operation.
 */
export interface SearchPostsOutput {
  /** The search query that was executed. */
  readonly query: string;
  /** List of matching posts. */
  readonly posts: FeedPost[];
  /** Cursor token for retrieving the next page, or null if no more pages. */
  readonly nextCursor: string | null;
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
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
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
    await waitForFeedLoad(client);

    // Collect posts — scroll to load more if needed
    const maxScrollAttempts = 10;
    let allPosts: RawDomPost[] = [];
    let previousCount = 0;

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

    return { query: input.query, posts, nextCursor };
  } finally {
    client.disconnect();
  }
}
