// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { PostEngager } from "../types/post-analytics.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { VoyagerInterceptor } from "../voyager/interceptor.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";
import { extractPostUrn } from "./get-post-stats.js";

/**
 * Input for the get-post-engagers operation.
 */
export interface GetPostEngagersInput extends ConnectionOptions {
  /** LinkedIn post URL or raw URN (e.g. `urn:li:activity:1234567890`). */
  readonly postUrl: string;
  /** Number of engagers to return per page (default: 20). */
  readonly count?: number | undefined;
  /** Offset for pagination (default: 0). */
  readonly start?: number | undefined;
}

/**
 * Output from the get-post-engagers operation.
 */
export interface GetPostEngagersOutput {
  /** Resolved post URN. */
  readonly postUrn: string;
  /** List of people who engaged with the post. */
  readonly engagers: PostEngager[];
  /** Pagination metadata. */
  readonly paging: {
    readonly start: number;
    readonly count: number;
    readonly total: number;
  };
}

/** Shape of the Voyager feed-reactions API response. */
interface VoyagerReactionsResponse {
  data?: {
    elements?: VoyagerReactionElement[];
    paging?: VoyagerPaging;
  };
  elements?: VoyagerReactionElement[];
  paging?: VoyagerPaging;
  included?: VoyagerIncludedEntity[];
}

interface VoyagerReactionElement {
  reactionType?: string;
  reactor?: VoyagerReactor;
  /** URN reference to an included mini-profile entity. */
  reactorUrn?: string;
  /** Alternative field name in some API versions. */
  "*reactor"?: string;
}

interface VoyagerReactor {
  firstName?: string;
  lastName?: string;
  publicIdentifier?: string;
  headline?: { text?: string } | string;
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

/**
 * Resolve a headline value that may be a string or an object with a `text` field.
 */
function resolveHeadline(
  headline: { text?: string } | string | undefined,
): string | null {
  if (headline === undefined || headline === null) return null;
  if (typeof headline === "string") return headline;
  return headline.text ?? null;
}

/**
 * Parse the Voyager reactions response into normalised PostEngager entries.
 *
 * LinkedIn's API may return reactor data inline or via `included` entity
 * references. This parser handles both patterns.
 */
function parseReactionsResponse(raw: VoyagerReactionsResponse): {
  engagers: PostEngager[];
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

  const engagers: PostEngager[] = [];

  for (const el of elements) {
    const reactionType = el.reactionType ?? "LIKE";

    // Try inline reactor first, then look up by URN in included entities
    let firstName = el.reactor?.firstName;
    let lastName = el.reactor?.lastName;
    let publicId = el.reactor?.publicIdentifier ?? null;
    let headline = resolveHeadline(el.reactor?.headline);

    if (firstName === undefined) {
      const urn = el.reactorUrn ?? el["*reactor"];
      if (urn) {
        const profile = profilesByUrn.get(urn);
        if (profile) {
          firstName = profile.firstName;
          lastName = profile.lastName;
          publicId = profile.publicIdentifier ?? null;
          headline =
            resolveHeadline(profile.headline) ?? profile.occupation ?? null;
        }
      }
    }

    engagers.push({
      firstName: firstName ?? "",
      lastName: lastName ?? "",
      publicId,
      headline,
      engagementType: reactionType,
    });
  }

  return {
    engagers,
    paging: {
      start: paging?.start ?? 0,
      count: paging?.count ?? engagers.length,
      total: paging?.total ?? engagers.length,
    },
  };
}

/**
 * Retrieve the list of people who engaged with a LinkedIn post.
 *
 * Connects to the LinkedIn webview in LinkedHelper and calls the
 * Voyager feed-reactions API to get the list of people who reacted
 * to the post, with their profile data and reaction type.
 *
 * @param input - Post URL or URN, pagination parameters, and CDP connection options.
 * @returns List of engagers with pagination metadata.
 */
export async function getPostEngagers(
  input: GetPostEngagersInput,
): Promise<GetPostEngagersOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const count = input.count ?? 20;
  const start = input.start ?? 0;

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

    const encodedUrn = encodeURIComponent(postUrn);
    const path =
      `/voyager/api/feed/dash/feedReactions` +
      `?q=feedUpdate&feedUpdateUrn=${encodedUrn}` +
      `&start=${String(start)}&count=${String(count)}`;

    const response = await voyager.fetch(path);
    if (response.status !== 200) {
      throw new Error(
        `Voyager API returned HTTP ${String(response.status)} for post engagers`,
      );
    }

    const body = response.body;
    if (body === null || typeof body !== "object") {
      throw new Error(
        "Voyager API returned an unexpected response format for post engagers",
      );
    }

    const parsed = parseReactionsResponse(
      body as VoyagerReactionsResponse,
    );

    return {
      postUrn,
      engagers: parsed.engagers,
      paging: parsed.paging,
    };
  } finally {
    client.disconnect();
  }
}
