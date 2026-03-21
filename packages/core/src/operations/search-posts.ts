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
// Voyager response shapes
// ---------------------------------------------------------------------------

/** Top-level search clusters response. */
interface VoyagerSearchResponse {
  data?: {
    elements?: VoyagerSearchCluster[];
    paging?: VoyagerPaging;
  };
  elements?: VoyagerSearchCluster[];
  paging?: VoyagerPaging;
  included?: VoyagerIncludedEntity[];
}

interface VoyagerSearchCluster {
  items?: VoyagerSearchItem[];
}

interface VoyagerSearchItem {
  item?: {
    entityResult?: VoyagerEntityResult;
  };
}

interface VoyagerEntityResult {
  /** URN of the search result entity (e.g. `urn:li:activity:...`). */
  entityUrn?: string;
  /** Reference to the underlying update entity in `included`. */
  "*entity"?: string;
  title?: VoyagerTextWrapper;
  primarySubtitle?: VoyagerTextWrapper;
  summary?: VoyagerTextWrapper;
  insightsResolutionResults?: VoyagerInsight[];
  socialProofText?: string;
  secondarySubtitle?: VoyagerTextWrapper;
}

interface VoyagerTextWrapper {
  text?: string;
}

interface VoyagerInsight {
  simpleInsight?: {
    title?: VoyagerTextWrapper;
  };
}

interface VoyagerIncludedEntity {
  $type?: string;
  entityUrn?: string;
  /** Reference to the actor profile. */
  "*actor"?: string;
  actor?: VoyagerActor;
  commentary?: VoyagerTextWrapper;
  socialDetail?: VoyagerSocialDetail | string;
  numLikes?: number;
  numComments?: number;
  firstName?: string;
  lastName?: string;
  publicIdentifier?: string;
  headline?: VoyagerTextWrapper | string;
  occupation?: string;
}

interface VoyagerActor {
  name?: VoyagerTextWrapper;
  description?: VoyagerTextWrapper;
  navigationUrl?: string;
}

interface VoyagerSocialDetail {
  totalSocialActivityCounts?: {
    numLikes?: number;
    numComments?: number;
  };
}

interface VoyagerPaging {
  start?: number;
  count?: number;
  total?: number;
}

/**
 * Extract a LinkedIn public identifier from a navigation URL.
 *
 * Handles patterns like:
 * - `https://www.linkedin.com/in/johndoe`
 * - `https://www.linkedin.com/in/johndoe?miniProfileUrn=...`
 */
export function extractPublicId(url: string | undefined): string | null {
  if (!url) return null;
  const match = /linkedin\.com\/in\/([^/?]+)/.exec(url);
  return match?.[1] ?? null;
}

/**
 * Resolve a headline value that may be a string or an object with a `text` field.
 */
function resolveTextOrWrapper(
  value: VoyagerTextWrapper | string | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  return value.text ?? null;
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
 * Parse the Voyager content search response into normalised search results.
 *
 * LinkedIn's search API returns results in a "clusters" structure with
 * entities referenced via URN in the `included` array. This parser
 * handles both inline and reference-based entity resolution.
 */
export function parseSearchResponse(raw: VoyagerSearchResponse): {
  posts: SearchPostResult[];
  paging: { start: number; count: number; total: number };
} {
  const clusters = raw.data?.elements ?? raw.elements ?? [];
  const paging = raw.data?.paging ?? raw.paging;
  const included = raw.included ?? [];

  // Build lookup maps for included entities by URN
  const entitiesByUrn = new Map<string, VoyagerIncludedEntity>();
  for (const entity of included) {
    if (entity.entityUrn) {
      entitiesByUrn.set(entity.entityUrn, entity);
    }
  }

  const posts: SearchPostResult[] = [];

  for (const cluster of clusters) {
    for (const searchItem of cluster.items ?? []) {
      const entityResult = searchItem.item?.entityResult;
      if (!entityResult) continue;

      const postUrn = extractActivityUrn(entityResult.entityUrn);
      if (!postUrn) continue;

      // Try to find the update entity in included
      const entityRef = entityResult["*entity"] ?? entityResult.entityUrn;
      const updateEntity = entityRef
        ? entitiesByUrn.get(entityRef)
        : undefined;

      // Extract post text from entity result summary or update commentary
      const text =
        entityResult.summary?.text ??
        updateEntity?.commentary?.text ??
        null;

      // Extract author info from entity result or included actor
      let authorFirstName: string | null = null;
      let authorLastName: string | null = null;
      let authorPublicId: string | null = null;
      let authorHeadline: string | null = null;

      // Try entity result title (author name in search results)
      const authorName = entityResult.title?.text ?? null;
      if (authorName) {
        const nameParts = authorName.split(" ");
        authorFirstName = nameParts[0] ?? null;
        authorLastName = nameParts.slice(1).join(" ") || null;
      }

      authorHeadline =
        entityResult.primarySubtitle?.text ?? null;

      // Try to resolve from included actor profile
      if (updateEntity?.["*actor"]) {
        const actorProfile = entitiesByUrn.get(updateEntity["*actor"]);
        if (actorProfile) {
          if (!authorFirstName) {
            authorFirstName = actorProfile.firstName ?? null;
          }
          if (!authorLastName) {
            authorLastName = actorProfile.lastName ?? null;
          }
          if (!authorPublicId) {
            authorPublicId = actorProfile.publicIdentifier ?? null;
          }
          if (!authorHeadline) {
            authorHeadline = resolveTextOrWrapper(actorProfile.headline) ??
              actorProfile.occupation ?? null;
          }
        }
      }

      // Try to extract publicId from actor navigation URL
      if (!authorPublicId && updateEntity?.actor?.navigationUrl) {
        authorPublicId = extractPublicId(
          updateEntity.actor.navigationUrl,
        );
      }

      // Extract engagement counts
      let reactionCount = 0;
      let commentCount = 0;

      if (updateEntity?.socialDetail && typeof updateEntity.socialDetail === "object") {
        reactionCount =
          updateEntity.socialDetail.totalSocialActivityCounts?.numLikes ?? 0;
        commentCount =
          updateEntity.socialDetail.totalSocialActivityCounts?.numComments ?? 0;
      } else {
        reactionCount = updateEntity?.numLikes ?? 0;
        commentCount = updateEntity?.numComments ?? 0;
      }

      posts.push({
        postUrn,
        text,
        authorFirstName,
        authorLastName,
        authorPublicId,
        authorHeadline,
        reactionCount,
        commentCount,
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
  const count = input.count ?? 10;
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

    const encodedQuery = encodeURIComponent(input.query);
    const encodedFilters = encodeURIComponent("List(resultType->CONTENT)");
    const path =
      `/voyager/api/search/dash/clusters` +
      `?q=all` +
      `&keywords=${encodedQuery}` +
      `&filters=${encodedFilters}` +
      `&origin=GLOBAL_SEARCH_HEADER` +
      `&start=${String(start)}` +
      `&count=${String(count)}`;

    const response = await voyager.fetch(path);
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

    const parsed = parseSearchResponse(body as VoyagerSearchResponse);

    return {
      query: input.query,
      posts: parsed.posts,
      paging: parsed.paging,
    };
  } finally {
    client.disconnect();
  }
}
