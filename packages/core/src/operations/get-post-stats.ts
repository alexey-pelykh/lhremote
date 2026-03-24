// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { PostStats, ReactionCount } from "../types/post-analytics.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { VoyagerInterceptor } from "../voyager/interceptor.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

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

/** Reaction-type count entry in the REST feed update response. */
interface VoyagerReactionTypeCount {
  reactionType?: string;
  count?: number;
}

/** Social activity counts block from the REST /feed/updates/{urn} response. */
interface VoyagerSocialActivityCounts {
  numLikes?: number;
  numComments?: number;
  numShares?: number;
  reactionTypeCounts?: VoyagerReactionTypeCount[];
}

/** Social detail block wrapping the activity counts. */
interface VoyagerSocialDetail {
  totalSocialActivityCounts?: VoyagerSocialActivityCounts;
}

/**
 * Shape of the REST /feed/updates/{urn} response, from which post stats
 * are extracted.  Supports both nested (data.socialDetail.) and flat layouts.
 */
interface VoyagerFeedUpdateStatsResponse {
  data?: {
    socialDetail?: VoyagerSocialDetail;
    totalSocialActivityCounts?: VoyagerSocialActivityCounts;
  };
  // Flat-structure variants
  socialDetail?: VoyagerSocialDetail;
  totalSocialActivityCounts?: VoyagerSocialActivityCounts;
}

/**
 * Parse the REST feed-update response into a normalised PostStats.
 *
 * The `totalSocialActivityCounts` block (and its nested
 * `reactionTypeCounts` array) can appear at several nesting depths
 * depending on the LinkedIn response variant:
 *   - `socialDetail.totalSocialActivityCounts`
 *   - `data.socialDetail.totalSocialActivityCounts`
 *   - `totalSocialActivityCounts` (flat)
 *   - `data.totalSocialActivityCounts` (flat under data)
 */
export function parseFeedUpdateStatsResponse(
  raw: VoyagerFeedUpdateStatsResponse,
  postUrn: string,
): PostStats {
  const counts =
    raw.data?.socialDetail?.totalSocialActivityCounts ??
    raw.socialDetail?.totalSocialActivityCounts ??
    raw.data?.totalSocialActivityCounts ??
    raw.totalSocialActivityCounts;

  const rawReactions = counts?.reactionTypeCounts ?? [];

  const reactionsByType: ReactionCount[] = rawReactions
    .filter(
      (r): r is { reactionType: string; count: number } =>
        r.reactionType !== undefined && r.count !== undefined,
    )
    .map((r) => ({ type: r.reactionType, count: r.count }));

  const reactionCount =
    reactionsByType.length > 0
      ? reactionsByType.reduce((sum, r) => sum + r.count, 0)
      : (counts?.numLikes ?? 0);

  return {
    postUrn,
    reactionCount,
    reactionsByType,
    commentCount: counts?.numComments ?? 0,
    shareCount: counts?.numShares ?? 0,
  };
}

/**
 * Retrieve engagement statistics for a LinkedIn post.
 *
 * Connects to the LinkedIn webview in LinkedHelper, navigates to the
 * post detail page, and passively intercepts the REST `/feed/updates/{urn}`
 * response to extract reaction breakdown, comment count, and share count.
 *
 * @param input - Post URL or URN and CDP connection parameters.
 * @returns Engagement statistics for the post.
 */
export async function getPostStats(
  input: GetPostStatsInput,
): Promise<GetPostStatsOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;

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
    await voyager.enable();

    try {
      // Register the response listener before navigating to avoid race conditions.
      const responsePromise = voyager.waitForResponse((url) =>
        url.includes("/feed/updates/"),
      );

      // Navigate to the post detail page — LinkedIn's SPA will fetch the
      // update data naturally via REST /feed/updates/{urn}.
      const postDetailUrl = `https://www.linkedin.com/feed/update/${postUrn}/`;
      await client.navigate(postDetailUrl);

      const response = await responsePromise;
      if (response.status !== 200) {
        throw new Error(
          `Voyager API returned HTTP ${String(response.status)} for post stats`,
        );
      }

      const body = response.body;
      if (body === null || typeof body !== "object") {
        throw new Error(
          "Voyager API returned an unexpected response format for post stats",
        );
      }

      const stats = parseFeedUpdateStatsResponse(
        body as VoyagerFeedUpdateStatsResponse,
        postUrn,
      );

      return { stats };
    } finally {
      await voyager.disable();
    }
  } finally {
    client.disconnect();
  }
}
