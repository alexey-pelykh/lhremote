// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { PostComment, PostDetail } from "../types/post.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { VoyagerInterceptor } from "../voyager/interceptor.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";
import { extractPostUrn } from "./get-post-stats.js";

/**
 * Input for the get-post operation.
 */
export interface GetPostInput extends ConnectionOptions {
  /** LinkedIn post URL or raw URN (e.g. `urn:li:activity:1234567890`). */
  readonly postUrl: string;
  /** Number of comments to return per page (default: 10). */
  readonly commentCount?: number | undefined;
  /** Offset for comment pagination (default: 0). */
  readonly commentStart?: number | undefined;
}

/**
 * Output from the get-post operation.
 */
export interface GetPostOutput {
  /** Full post detail. */
  readonly post: PostDetail;
  /** Comments on this post. */
  readonly comments: PostComment[];
  /** Comment pagination metadata. */
  readonly commentsPaging: {
    readonly start: number;
    readonly count: number;
    readonly total: number;
  };
}

// ---------------------------------------------------------------------------
// Voyager response shapes — post detail
// ---------------------------------------------------------------------------

/** Shape of a Voyager feed update response. */
interface VoyagerFeedUpdateResponse {
  data?: VoyagerFeedUpdateData;
  // Flat-structure variant
  actor?: VoyagerActor;
  commentary?: VoyagerCommentary;
  publishedAt?: number;
  socialDetail?: VoyagerSocialDetail;
  included?: VoyagerIncludedEntity[];
}

interface VoyagerFeedUpdateData {
  actor?: VoyagerActor | string;
  commentary?: VoyagerCommentary;
  publishedAt?: number;
  socialDetail?: VoyagerSocialDetail;
  // Batch fetch returns elements array
  elements?: VoyagerFeedUpdateElement[];
  "*actor"?: string;
}

interface VoyagerFeedUpdateElement {
  actor?: VoyagerActor | string;
  commentary?: VoyagerCommentary;
  publishedAt?: number;
  socialDetail?: VoyagerSocialDetail;
  "*actor"?: string;
}

interface VoyagerActor {
  name?: { text?: string } | string;
  description?: { text?: string } | string;
  navigationUrl?: string;
  // Some responses have flat name fields
  firstName?: string;
  lastName?: string;
  publicIdentifier?: string;
  headline?: { text?: string } | string;
  image?: unknown;
}

interface VoyagerCommentary {
  text?: { text?: string } | string;
}

interface VoyagerSocialDetail {
  totalSocialActivityCounts?: {
    numLikes?: number;
    numComments?: number;
    numShares?: number;
  };
}

// ---------------------------------------------------------------------------
// Voyager response shapes — comments
// ---------------------------------------------------------------------------

interface VoyagerCommentsResponse {
  data?: {
    elements?: VoyagerCommentElement[];
    paging?: VoyagerPaging;
  };
  elements?: VoyagerCommentElement[];
  paging?: VoyagerPaging;
  included?: VoyagerIncludedEntity[];
}

interface VoyagerCommentElement {
  urn?: string;
  entityUrn?: string;
  commenter?: VoyagerCommenter;
  "*commenter"?: string;
  commenterUrn?: string;
  comment?: { values?: Array<{ value?: string }> } | { text?: string } | string;
  commentV2?: { text?: { text?: string } | string };
  commentary?: { text?: { text?: string } | string };
  createdTime?: number;
  created?: { time?: number };
  socialDetail?: VoyagerSocialDetail;
}

interface VoyagerCommenter {
  firstName?: string;
  lastName?: string;
  publicIdentifier?: string;
  headline?: { text?: string } | string;
  occupation?: string;
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
}

interface VoyagerPaging {
  start?: number;
  count?: number;
  total?: number;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a text value that may be a string or an object with a `text` field.
 */
export function resolveTextValue(
  value: { text?: string } | string | undefined | null,
): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return value.text ?? "";
}

/**
 * Extract public identifier from a LinkedIn navigation URL.
 */
function extractPublicId(url: string | undefined): string | null {
  if (!url) return null;
  const match = /linkedin\.com\/in\/([^/?]+)/.exec(url);
  return match?.[1] ?? null;
}

/**
 * Parse the Voyager feed update response into a normalised PostDetail.
 */
export function parseFeedUpdateResponse(
  raw: VoyagerFeedUpdateResponse,
  postUrn: string,
  included: VoyagerIncludedEntity[],
): PostDetail {
  // Resolve the feed update element — try nested data, data.elements, or flat
  const element: VoyagerFeedUpdateElement =
    raw.data?.elements?.[0] ?? raw.data ?? raw;

  // Build included entity lookup
  const profilesByUrn = new Map<string, VoyagerIncludedEntity>();
  for (const entity of included) {
    if (entity.entityUrn) {
      profilesByUrn.set(entity.entityUrn, entity);
    }
  }

  // Resolve actor — may be inline object, URN reference, or in included
  let authorName = "";
  let authorHeadline: string | null = null;
  let authorPublicId: string | null = null;

  const actorValue = element.actor;
  if (typeof actorValue === "string") {
    // URN reference — look up in included
    const profile = profilesByUrn.get(actorValue);
    if (profile) {
      authorName = resolveActorName(profile);
      authorHeadline = resolveTextValue(profile.description ?? profile.headline) || null;
      authorPublicId = profile.publicIdentifier ?? extractPublicId(profile.navigationUrl ?? undefined);
    }
  } else if (actorValue) {
    authorName = resolveActorName(actorValue);
    authorHeadline = resolveTextValue(actorValue.description ?? actorValue.headline) || null;
    authorPublicId = actorValue.publicIdentifier ?? extractPublicId(actorValue.navigationUrl);
  } else {
    // Try *actor URN reference
    const actorUrn = element["*actor"] ?? raw.data?.["*actor"];
    if (actorUrn) {
      const profile = profilesByUrn.get(actorUrn);
      if (profile) {
        authorName = resolveActorName(profile);
        authorHeadline = resolveTextValue(profile.description ?? profile.headline) || null;
        authorPublicId = profile.publicIdentifier ?? extractPublicId(profile.navigationUrl ?? undefined);
      }
    }
  }

  // Resolve commentary text
  const commentary = element.commentary ?? raw.data?.commentary;
  const text = resolveTextValue(commentary?.text);

  // Resolve timestamps
  const publishedAt = element.publishedAt ?? raw.data?.publishedAt ?? null;

  // Resolve social counts
  const social =
    element.socialDetail ?? raw.data?.socialDetail ?? raw.socialDetail;
  const counts = social?.totalSocialActivityCounts;

  return {
    postUrn,
    authorName,
    authorHeadline,
    authorPublicId,
    text,
    publishedAt,
    reactionCount: counts?.numLikes ?? 0,
    commentCount: counts?.numComments ?? 0,
    shareCount: counts?.numShares ?? 0,
  };
}

/**
 * Resolve actor display name from various response shapes.
 */
function resolveActorName(
  actor: VoyagerActor | VoyagerIncludedEntity,
): string {
  // Try name.text pattern (actor object from feed updates)
  const nameText = resolveTextValue(actor.name);
  if (nameText) return nameText;

  // Try firstName + lastName pattern (mini-profile)
  if (actor.firstName || actor.lastName) {
    return [actor.firstName, actor.lastName].filter(Boolean).join(" ");
  }

  return "";
}

/**
 * Parse the Voyager comments response into normalised PostComment entries.
 */
export function parseCommentsResponse(raw: VoyagerCommentsResponse): {
  comments: PostComment[];
  paging: { start: number; count: number; total: number };
} {
  const elements = raw.data?.elements ?? raw.elements ?? [];
  const paging = raw.data?.paging ?? raw.paging;
  const included = raw.included ?? [];

  // Build a lookup for included mini-profile entities
  const profilesByUrn = new Map<string, VoyagerIncludedEntity>();
  for (const entity of included) {
    if (entity.entityUrn) {
      profilesByUrn.set(entity.entityUrn, entity);
    }
  }

  const comments: PostComment[] = [];

  for (const el of elements) {
    const commentUrn = el.urn ?? el.entityUrn ?? null;

    // Resolve commenter
    let authorName = "";
    let authorHeadline: string | null = null;
    let authorPublicId: string | null = null;

    if (el.commenter) {
      authorName = [el.commenter.firstName, el.commenter.lastName]
        .filter(Boolean)
        .join(" ");
      authorHeadline =
        resolveTextValue(el.commenter.headline) ||
        el.commenter.occupation ||
        null;
      authorPublicId = el.commenter.publicIdentifier ?? null;
    } else {
      // Try URN reference lookup
      const commenterUrn = el.commenterUrn ?? el["*commenter"];
      if (commenterUrn) {
        const profile = profilesByUrn.get(commenterUrn);
        if (profile) {
          authorName = [profile.firstName, profile.lastName]
            .filter(Boolean)
            .join(" ");
          authorHeadline =
            resolveTextValue(profile.headline) ||
            profile.occupation ||
            null;
          authorPublicId = profile.publicIdentifier ?? null;
        }
      }
    }

    // Resolve comment text — multiple possible shapes
    let text = "";
    if (el.commentV2) {
      text = resolveTextValue(el.commentV2.text);
    } else if (el.commentary) {
      text = resolveTextValue(el.commentary.text);
    } else if (el.comment) {
      if (typeof el.comment === "string") {
        text = el.comment;
      } else if ("text" in el.comment) {
        text = resolveTextValue(
          (el.comment as { text?: string }).text,
        );
      } else if ("values" in el.comment) {
        const vals = (el.comment as { values?: Array<{ value?: string }> })
          .values;
        text = vals?.map((v) => v.value ?? "").join("") ?? "";
      }
    }

    // Resolve timestamp
    const createdAt = el.createdTime ?? el.created?.time ?? null;

    // Resolve reaction count
    const reactionCount =
      el.socialDetail?.totalSocialActivityCounts?.numLikes ?? 0;

    comments.push({
      commentUrn,
      authorName,
      authorHeadline,
      authorPublicId,
      text,
      createdAt,
      reactionCount,
    });
  }

  return {
    comments,
    paging: {
      start: paging?.start ?? 0,
      count: paging?.count ?? comments.length,
      total: paging?.total ?? comments.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Main operation
// ---------------------------------------------------------------------------

/**
 * Retrieve detailed data for a single LinkedIn post with its comment thread.
 *
 * Connects to the LinkedIn webview in LinkedHelper and calls the
 * Voyager API to fetch the post entity and its comments.
 *
 * @param input - Post URL or URN, comment pagination parameters, and CDP connection options.
 * @returns Post detail with comments and pagination metadata.
 */
export async function getPost(input: GetPostInput): Promise<GetPostOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const commentCount = input.commentCount ?? 10;
  const commentStart = input.commentStart ?? 0;

  const postUrn = extractPostUrn(input.postUrl);

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

    // Fetch post detail
    const encodedUrn = encodeURIComponent(postUrn);
    const postPath = `/voyager/api/feed/updates/${encodedUrn}`;

    const postResponse = await voyager.fetch(postPath);
    if (postResponse.status !== 200) {
      throw new Error(
        `Voyager API returned HTTP ${String(postResponse.status)} for post detail`,
      );
    }

    const postBody = postResponse.body;
    if (postBody === null || typeof postBody !== "object") {
      throw new Error(
        "Voyager API returned an unexpected response format for post detail",
      );
    }

    const rawPost = postBody as VoyagerFeedUpdateResponse;
    const post = parseFeedUpdateResponse(
      rawPost,
      postUrn,
      rawPost.included ?? [],
    );

    // Fetch comments — gracefully degrade when the endpoint is unavailable
    // (LinkedIn deprecated /feed/dash/feedComments, tracked in #523).
    let comments: PostComment[] = [];
    let commentsPaging = { start: commentStart, count: 0, total: 0 };

    const commentsPath =
      `/voyager/api/feed/dash/feedComments` +
      `?q=commentsUnderFeedUpdate&updateUrn=${encodedUrn}` +
      `&start=${String(commentStart)}&count=${String(commentCount)}`;

    const commentsResponse = await voyager.fetch(commentsPath);
    if (commentsResponse.status === 200) {
      const commentsBody = commentsResponse.body;
      if (commentsBody !== null && typeof commentsBody === "object") {
        const parsed = parseCommentsResponse(
          commentsBody as VoyagerCommentsResponse,
        );
        comments = parsed.comments;
        commentsPaging = parsed.paging;
      }
    }

    return {
      post,
      comments,
      commentsPaging,
    };
  } finally {
    client.disconnect();
  }
}
