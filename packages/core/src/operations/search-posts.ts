// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { SearchPostResult } from "../types/search-posts.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { VoyagerInterceptor } from "../voyager/interceptor.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the search-posts operation.
 */
export interface SearchPostsInput extends ConnectionOptions {
  /** Search query (keywords or hashtag, e.g. `"AI agents"` or `"#AIAgents"`). */
  readonly query: string;
  /** Number of results per page (default: 10). */
  readonly count?: number | undefined;
  /** Pagination offset (default: 0). */
  readonly start?: number | undefined;
}

/**
 * Output from the search-posts operation.
 */
export interface SearchPostsOutput {
  /** The search query that was executed. */
  readonly query: string;
  /** List of matching posts. */
  readonly posts: SearchPostResult[];
  /** Pagination metadata. */
  readonly paging: {
    readonly start: number;
    readonly count: number;
    readonly total: number;
  };
}

// ---------------------------------------------------------------------------
// GraphQL search response shapes
// ---------------------------------------------------------------------------

/** Top-level GraphQL response wrapper. */
interface GraphQLSearchResponse {
  data?: {
    /** LinkedIn sometimes wraps GraphQL responses in a nested `data` object. */
    data?: {
      searchDashClustersByAll?: GraphQLSearchCollection;
    };
    searchDashClustersByAll?: GraphQLSearchCollection;
  };
}

/** The collection returned by the searchDashClustersByAll query. */
interface GraphQLSearchCollection {
  elements?: GraphQLSearchCluster[];
  paging?: GraphQLSearchPaging;
}

interface GraphQLSearchCluster {
  items?: GraphQLSearchItem[];
}

interface GraphQLSearchItem {
  item?: {
    entityResult?: GraphQLEntityResult;
  };
}

interface GraphQLEntityResult {
  /** URN of the search result entity (e.g. `urn:li:activity:...`). */
  entityUrn?: string;
  title?: GraphQLSearchTextWrapper;
  primarySubtitle?: GraphQLSearchTextWrapper;
  summary?: GraphQLSearchTextWrapper;
  insightsResolutionResults?: GraphQLInsight[];
  socialProofText?: string;
  secondarySubtitle?: GraphQLSearchTextWrapper;
}

interface GraphQLSearchTextWrapper {
  text?: string;
}

interface GraphQLInsight {
  simpleInsight?: {
    title?: GraphQLSearchTextWrapper;
  };
}

interface GraphQLSearchPaging {
  start?: number;
  count?: number;
  total?: number;
}

/**
 * Extract the activity URN from the entity URN.
 *
 * The search API may return URNs in several formats:
 * - `urn:li:fs_updateV2:(urn:li:activity:1234,...)` → extract `urn:li:activity:1234`
 * - `urn:li:activity:1234` → use directly
 * - `urn:li:ugcPost:1234` → use directly
 */
export function extractActivityUrn(urn: string | undefined): string | null {
  if (!urn) return null;

  // Extract nested activity URN from fs_updateV2 wrapper
  // e.g. urn:li:fs_updateV2:(urn:li:activity:123,FEED_DETAIL)
  const nestedMatch = /\((urn:li:(?:activity|ugcPost):\d+)[,)]/.exec(urn);
  if (nestedMatch?.[1]) return nestedMatch[1];

  // Direct activity/ugcPost URN
  if (/^urn:li:(?:activity|ugcPost):\d+$/.test(urn)) return urn;

  return urn;
}

/**
 * Parse the GraphQL content search response into normalised search results.
 *
 * LinkedIn's GraphQL search API returns results in a "clusters" structure
 * within the `searchDashClustersByAll` query. Each cluster contains items
 * with entity results carrying author info, post text, and engagement data.
 */
export function parseSearchResponse(raw: GraphQLSearchResponse): {
  posts: SearchPostResult[];
  paging: { start: number; count: number; total: number };
} {
  const collection =
    raw.data?.data?.searchDashClustersByAll ??
    raw.data?.searchDashClustersByAll;
  const clusters = collection?.elements ?? [];
  const paging = collection?.paging;

  const posts: SearchPostResult[] = [];

  for (const cluster of clusters) {
    for (const searchItem of cluster.items ?? []) {
      const entityResult = searchItem.item?.entityResult;
      if (!entityResult) continue;

      const postUrn = extractActivityUrn(entityResult.entityUrn);
      if (!postUrn) continue;

      // Extract post text from entity result summary
      const text = entityResult.summary?.text ?? null;

      // Extract author info from entity result
      let authorFirstName: string | null = null;
      let authorLastName: string | null = null;
      const authorHeadline =
        entityResult.primarySubtitle?.text ?? null;

      // Parse author name from title
      const authorName = entityResult.title?.text ?? null;
      if (authorName) {
        const nameParts = authorName.split(" ");
        authorFirstName = nameParts[0] ?? null;
        authorLastName = nameParts.slice(1).join(" ") || null;
      }

      posts.push({
        postUrn,
        text,
        authorFirstName,
        authorLastName,
        authorPublicId: null,
        authorHeadline,
        reactionCount: 0,
        commentCount: 0,
      });
    }
  }

  return {
    posts,
    paging: {
      start: paging?.start ?? 0,
      count: paging?.count ?? posts.length,
      total: paging?.total ?? posts.length,
    },
  };
}

/**
 * Search LinkedIn for posts matching a keyword query.
 *
 * Connects to the LinkedIn webview in LinkedHelper and calls the
 * Voyager search API with content-type filtering to find posts.
 * Supports keyword search, hashtag search, and cursor-based pagination.
 *
 * @param input - Search query, pagination parameters, and CDP connection options.
 * @returns List of matching posts with pagination metadata.
 */
export async function searchPosts(
  input: SearchPostsInput,
): Promise<SearchPostsOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const start = input.start ?? 0;

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
    const voyager = new VoyagerInterceptor(client);
    await voyager.enable();

    try {
      // Set up the response listener before navigation to avoid race conditions.
      // The filter matches the query name prefix, ignoring the rotating hash suffix.
      const responsePromise = voyager.waitForResponse((url) =>
        url.includes("voyagerSearchDashClusters"),
      );

      // Navigate to LinkedIn content search — the page makes the Voyager API
      // call with its own current queryId hash.
      const searchUrl = new URL(
        "https://www.linkedin.com/search/results/content/",
      );
      searchUrl.searchParams.set("keywords", input.query);
      searchUrl.searchParams.set("origin", "GLOBAL_SEARCH_HEADER");
      if (start > 0) {
        searchUrl.searchParams.set("start", String(start));
      }
      await client.navigate(searchUrl.toString());

      const response = await responsePromise;
      if (response.status !== 200) {
        throw new Error(
          `Voyager API returned HTTP ${String(response.status)} for post search`,
        );
      }

      const body = response.body;
      if (body === null || typeof body !== "object") {
        throw new Error(
          "Voyager API returned an unexpected response format for post search",
        );
      }

      const parsed = parseSearchResponse(body as GraphQLSearchResponse);

      return {
        query: input.query,
        posts: parsed.posts,
        paging: parsed.paging,
      };
    } finally {
      await voyager.disable();
    }
  } finally {
    client.disconnect();
  }
}
