// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { FeedPost } from "../types/feed.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { VoyagerInterceptor } from "../voyager/interceptor.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the get-profile-activity operation.
 */
export interface GetProfileActivityInput extends ConnectionOptions {
  /** LinkedIn profile public ID or full profile URL. */
  readonly profile: string;
  /** Number of posts to return per page (default: 20). */
  readonly count?: number | undefined;
  /** Offset for pagination (default: 0). */
  readonly start?: number | undefined;
}

/**
 * Output from the get-profile-activity operation.
 */
export interface GetProfileActivityOutput {
  /** Resolved profile public ID. */
  readonly profilePublicId: string;
  /** List of posts from the profile. */
  readonly posts: FeedPost[];
  /** Pagination metadata. */
  readonly paging: {
    readonly start: number;
    readonly count: number;
    readonly total: number;
  };
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
// Voyager API response shapes
// ---------------------------------------------------------------------------

interface VoyagerProfileUpdatesResponse {
  data?: {
    elements?: VoyagerFeedElement[];
    paging?: VoyagerPaging;
  };
  elements?: VoyagerFeedElement[];
  paging?: VoyagerPaging;
  included?: VoyagerIncludedEntity[];
}

interface VoyagerFeedElement {
  actor?: {
    name?: { text?: string };
    publicIdentifier?: string;
    description?: { text?: string };
    urn?: string;
    "*miniProfile"?: string;
  };
  commentary?: {
    text?: { text?: string };
  };
  socialDetail?: {
    totalSocialActivityCounts?: {
      numLikes?: number;
      numComments?: number;
      numShares?: number;
    };
  };
  updateMetadata?: {
    urn?: string;
    shareUrl?: string;
  };
  publishedAt?: number;
  /** Alternative: some API versions use a top-level urn. */
  urn?: string;
  /** Alternative: resharedUpdate text in some versions. */
  resharedUpdate?: {
    commentary?: { text?: { text?: string } };
  };
}

interface VoyagerIncludedEntity {
  $type?: string;
  entityUrn?: string;
  firstName?: string;
  lastName?: string;
  publicIdentifier?: string;
  headline?: { text?: string } | string;
  occupation?: string;
}

interface VoyagerPaging {
  start?: number;
  count?: number;
  total?: number;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Resolve a headline value that may be a string or an object with a `text` field.
 */
function resolveText(
  value: { text?: string } | string | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  return value.text ?? null;
}

/**
 * Build a lookup map of included mini-profile entities by URN.
 */
function buildProfileLookup(
  included: VoyagerIncludedEntity[],
): Map<string, VoyagerIncludedEntity> {
  const map = new Map<string, VoyagerIncludedEntity>();
  for (const entity of included) {
    if (entity.entityUrn) {
      map.set(entity.entityUrn, entity);
    }
  }
  return map;
}

/**
 * Parse the Voyager profile-updates response into normalised FeedPost entries.
 */
function parseProfileUpdatesResponse(
  raw: VoyagerProfileUpdatesResponse,
): {
  posts: FeedPost[];
  paging: { start: number; count: number; total: number };
} {
  const elements = raw.data?.elements ?? raw.elements ?? [];
  const paging = raw.data?.paging ?? raw.paging;
  const included = raw.included ?? [];
  const profilesByUrn = buildProfileLookup(included);

  const posts: FeedPost[] = [];

  for (const el of elements) {
    const urn = el.updateMetadata?.urn ?? el.urn;
    if (!urn) continue;

    // Resolve text — primary commentary, fall back to reshared
    const text =
      resolveText(el.commentary?.text) ??
      resolveText(el.resharedUpdate?.commentary?.text) ??
      null;

    // Resolve author info — inline actor or included entity lookup
    let authorName: string | null = resolveText(el.actor?.name) ?? null;
    let authorPublicId: string | null = el.actor?.publicIdentifier ?? null;
    let authorHeadline: string | null =
      resolveText(el.actor?.description) ?? null;

    if (authorName === null) {
      const actorUrn = el.actor?.urn ?? el.actor?.["*miniProfile"];
      if (actorUrn) {
        const profile = profilesByUrn.get(actorUrn);
        if (profile) {
          authorName = [profile.firstName, profile.lastName]
            .filter(Boolean)
            .join(" ") || null;
          authorPublicId = profile.publicIdentifier ?? null;
          authorHeadline =
            resolveText(profile.headline) ?? profile.occupation ?? null;
        }
      }
    }

    // Build post URL from share URL or URN
    const url = el.updateMetadata?.shareUrl ?? null;

    // Social counts
    const counts = el.socialDetail?.totalSocialActivityCounts;

    posts.push({
      urn,
      url,
      authorName,
      authorHeadline,
      authorProfileUrl: null,
      authorPublicId,
      text,
      mediaType: null,
      reactionCount: counts?.numLikes ?? 0,
      commentCount: counts?.numComments ?? 0,
      shareCount: counts?.numShares ?? 0,
      timestamp: el.publishedAt ?? null,
      hashtags: [],
    });
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

// ---------------------------------------------------------------------------
// Main operation
// ---------------------------------------------------------------------------

/**
 * Retrieve recent posts/activity from a LinkedIn profile.
 *
 * Connects to the LinkedIn webview in LinkedHelper and calls the
 * Voyager identity/profileUpdates API to get the profile's recent
 * posts with engagement counts.
 *
 * @param input - Profile identifier, pagination, and CDP connection options.
 * @returns List of posts with pagination metadata.
 */
export async function getProfileActivity(
  input: GetProfileActivityInput,
): Promise<GetProfileActivityOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const count = input.count ?? 20;
  const start = input.start ?? 0;

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
    const voyager = new VoyagerInterceptor(client);

    const encodedId = encodeURIComponent(profilePublicId);
    const profileUrn = `urn:li:fsd_profile:${encodedId}`;
    const encodedUrn = encodeURIComponent(profileUrn);
    const path =
      `/voyager/api/identity/dash/profileUpdates` +
      `?q=memberShareFeed&profileUrn=${encodedUrn}` +
      `&start=${String(start)}&count=${String(count)}`;

    const response = await voyager.fetch(path);
    if (response.status !== 200) {
      throw new Error(
        `Voyager API returned HTTP ${String(response.status)} for profile activity`,
      );
    }

    const body = response.body;
    if (body === null || typeof body !== "object") {
      throw new Error(
        "Voyager API returned an unexpected response format for profile activity",
      );
    }

    const parsed = parseProfileUpdatesResponse(
      body as VoyagerProfileUpdatesResponse,
    );

    return {
      profilePublicId,
      posts: parsed.posts,
      paging: parsed.paging,
    };
  } finally {
    client.disconnect();
  }
}
