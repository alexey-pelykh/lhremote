// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { FeedPost } from "../types/feed.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { VoyagerInterceptor } from "../voyager/interceptor.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

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
// Voyager response shapes
// ---------------------------------------------------------------------------

interface VoyagerFeedResponse {
  data?: {
    elements?: VoyagerFeedElement[];
    paging?: VoyagerFeedPaging;
    metadata?: VoyagerFeedMetadata;
  };
  elements?: VoyagerFeedElement[];
  paging?: VoyagerFeedPaging;
  metadata?: VoyagerFeedMetadata;
  included?: VoyagerIncludedEntity[];
}

interface VoyagerFeedElement {
  /** Feed update URN. */
  updateUrn?: string;
  /** Alternative URN field. */
  urn?: string;
  /** Actor URN reference. */
  "*actor"?: string;
  actor?: VoyagerActor;
  /** Commentary / post text. */
  commentary?: VoyagerCommentary;
  /** Content attachment. */
  content?: VoyagerContent;
  /** Social engagement counts. */
  socialDetail?: VoyagerSocialDetail;
  /** Alternative social detail URN reference. */
  "*socialDetail"?: string;
  /** Creation timestamp in milliseconds. */
  createdAt?: number;
  /** Alternative timestamp field. */
  publishedAt?: number;
}

interface VoyagerActor {
  name?: { text?: string } | string;
  description?: { text?: string } | string;
  navigationUrl?: string;
  urn?: string;
}

interface VoyagerCommentary {
  text?: { text?: string } | string;
}

interface VoyagerContent {
  "$type"?: string;
  /** Article content. */
  navigationUrl?: string;
  /** Media category hint from the API. */
  mediaCategory?: string;
}

interface VoyagerSocialDetail {
  totalSocialActivityCounts?: {
    numLikes?: number;
    numComments?: number;
    numShares?: number;
  };
}

interface VoyagerFeedPaging {
  start?: number;
  count?: number;
  total?: number;
}

interface VoyagerFeedMetadata {
  paginationToken?: string;
  /** Alternative cursor field name. */
  nextPageToken?: string;
}

interface VoyagerIncludedEntity {
  $type?: string;
  entityUrn?: string;
  firstName?: string;
  lastName?: string;
  publicIdentifier?: string;
  headline?: { text?: string } | string;
  occupation?: string;
  name?: { text?: string } | string;
  description?: { text?: string } | string;
  navigationUrl?: string;
  /** Nested social activity counts on included entities. */
  totalSocialActivityCounts?: {
    numLikes?: number;
    numComments?: number;
    numShares?: number;
  };
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a text value that may be a string or `{ text: string }`.
 */
function resolveText(
  value: { text?: string } | string | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  return value.text ?? null;
}

/**
 * Infer media type from Voyager content metadata.
 */
function inferMediaType(content: VoyagerContent | undefined): string | null {
  if (!content) return null;

  if (content.mediaCategory) {
    const cat = content.mediaCategory.toLowerCase();
    if (cat.includes("image")) return "image";
    if (cat.includes("video")) return "video";
    if (cat.includes("article")) return "article";
    if (cat.includes("document")) return "document";
    return cat;
  }

  const type = content.$type ?? "";
  if (type.includes("Image")) return "image";
  if (type.includes("Video")) return "video";
  if (type.includes("Article") || content.navigationUrl) return "article";
  if (type.includes("Document")) return "document";
  if (type) return type.split(".").pop()?.toLowerCase() ?? null;

  return null;
}

/**
 * Build a LinkedIn post URL from an update URN.
 */
function buildPostUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

/**
 * Parse the Voyager feed response into normalised FeedPost entries.
 */
function parseFeedResponse(raw: VoyagerFeedResponse): {
  posts: FeedPost[];
  nextCursor: string | null;
} {
  const elements = raw.data?.elements ?? raw.elements ?? [];
  const metadata = raw.data?.metadata ?? raw.metadata;
  const included = raw.included ?? [];

  // Build lookup for included entities (actors, social details)
  const entitiesByUrn = new Map<string, VoyagerIncludedEntity>();
  for (const entity of included) {
    if (entity.entityUrn) {
      entitiesByUrn.set(entity.entityUrn, entity);
    }
  }

  const posts: FeedPost[] = [];

  for (const el of elements) {
    const urn = el.updateUrn ?? el.urn;
    if (!urn) continue;

    // Resolve actor — inline or via included entities
    let authorName: string = "";
    let authorHeadline: string | null = null;
    let authorProfileUrl: string | null = null;

    if (el.actor) {
      authorName = resolveText(el.actor.name) ?? "";
      authorHeadline = resolveText(el.actor.description);
      authorProfileUrl = el.actor.navigationUrl ?? null;
    } else if (el["*actor"]) {
      const actorEntity = entitiesByUrn.get(el["*actor"]);
      if (actorEntity) {
        // Person actor
        if (actorEntity.firstName || actorEntity.lastName) {
          authorName = [actorEntity.firstName, actorEntity.lastName]
            .filter(Boolean)
            .join(" ");
          authorHeadline =
            resolveText(actorEntity.headline) ??
            actorEntity.occupation ??
            null;
          if (actorEntity.publicIdentifier) {
            authorProfileUrl = `https://www.linkedin.com/in/${actorEntity.publicIdentifier}/`;
          }
        } else {
          // Company / page actor
          authorName = resolveText(actorEntity.name) ?? "";
          authorHeadline = resolveText(actorEntity.description);
          authorProfileUrl = actorEntity.navigationUrl ?? null;
        }
      }
    }

    // Post text
    const text = resolveText(el.commentary?.text) ?? null;

    // Media type
    const mediaType = inferMediaType(el.content);

    // Engagement counts — inline or via included social detail
    let reactionCount = 0;
    let commentCount = 0;
    let shareCount = 0;

    const socialCounts = el.socialDetail?.totalSocialActivityCounts;
    if (socialCounts) {
      reactionCount = socialCounts.numLikes ?? 0;
      commentCount = socialCounts.numComments ?? 0;
      shareCount = socialCounts.numShares ?? 0;
    } else if (el["*socialDetail"]) {
      const socialEntity = entitiesByUrn.get(el["*socialDetail"]);
      if (socialEntity?.totalSocialActivityCounts) {
        reactionCount = socialEntity.totalSocialActivityCounts.numLikes ?? 0;
        commentCount = socialEntity.totalSocialActivityCounts.numComments ?? 0;
        shareCount = socialEntity.totalSocialActivityCounts.numShares ?? 0;
      }
    }

    // Timestamp
    const timestamp = el.createdAt ?? el.publishedAt ?? null;

    posts.push({
      urn,
      url: buildPostUrl(urn),
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

  const nextCursor =
    metadata?.paginationToken ?? metadata?.nextPageToken ?? null;

  return { posts, nextCursor };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the LinkedIn home feed and return structured post data.
 *
 * Connects to the LinkedIn webview in LinkedHelper and calls the
 * Voyager feed updates API. Supports cursor-based pagination: the
 * first call returns the first page; pass the returned `nextCursor`
 * in subsequent calls to retrieve additional pages.
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

    let path =
      `/voyager/api/feed/dash/feedUpdates` +
      `?count=${String(count)}&q=feedByType&moduleKey=feed`;

    if (input.cursor) {
      path += `&paginationToken=${encodeURIComponent(input.cursor)}`;
    }

    const response = await voyager.fetch(path);
    if (response.status !== 200) {
      throw new Error(
        `Voyager API returned HTTP ${String(response.status)} for feed`,
      );
    }

    const body = response.body;
    if (body === null || typeof body !== "object") {
      throw new Error(
        "Voyager API returned an unexpected response format for feed",
      );
    }

    const parsed = parseFeedResponse(body as VoyagerFeedResponse);

    return {
      posts: parsed.posts,
      nextCursor: parsed.nextCursor,
    };
  } finally {
    client.disconnect();
  }
}
