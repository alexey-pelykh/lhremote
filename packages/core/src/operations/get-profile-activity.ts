// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { FeedPost } from "../types/feed.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { VoyagerInterceptor } from "../voyager/interceptor.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";
import { navigateAwayIf } from "./navigate-away.js";

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
// GraphQL profile-updates response shapes
// ---------------------------------------------------------------------------

/** Top-level GraphQL response wrapper. @internal Exported for testing only. */
export interface GraphQLProfileUpdatesResponse {
  data?: {
    /** LinkedIn sometimes wraps GraphQL responses in a nested `data` object. */
    data?: {
      feedDashProfileUpdatesByProfileUpdates?: GraphQLProfileUpdatesCollection;
      feedDashProfileUpdatesByMemberShareFeed?: GraphQLProfileUpdatesCollection;
    };
    feedDashProfileUpdatesByProfileUpdates?: GraphQLProfileUpdatesCollection;
    feedDashProfileUpdatesByMemberShareFeed?: GraphQLProfileUpdatesCollection;
  };
  /** Rest.li included entities — resolved via `*elements` URN references. */
  included?: GraphQLProfileUpdateElement[];
}

/** The collection returned by the feedDashProfileUpdates query. */
interface GraphQLProfileUpdatesCollection {
  /** Inline elements (active fetch mode). */
  elements?: GraphQLProfileUpdateElement[];
  /** URN references to entities in the top-level `included` array (passive interception). */
  "*elements"?: string[];
  paging?: GraphQLPaging;
}

/** A single profile update element from the GraphQL endpoint. */
interface GraphQLProfileUpdateElement {
  /** Entity URN — present when resolved from the `included` array. */
  entityUrn?: string;
  metadata?: GraphQLElementMetadata;
  socialContent?: GraphQLSocialContent;
  header?: GraphQLHeader;
  commentary?: GraphQLCommentary;
  content?: GraphQLContent;
}

/** Per-element metadata carrying the activity URN. */
interface GraphQLElementMetadata {
  backendUrn?: string;
  shareUrn?: string;
}

/** Social content block on each element. */
interface GraphQLSocialContent {
  shareUrl?: string;
}

/** Actor header block containing the author identity. */
interface GraphQLHeader {
  text?: GraphQLTextAccessibility;
  image?: GraphQLImageAccessibility;
  navigationUrl?: string;
}

/** Accessibility-wrapped text (used by header, commentary, etc.). */
interface GraphQLTextAccessibility {
  text?: string;
  accessibilityText?: string;
}

interface GraphQLImageAccessibility {
  accessibilityText?: string;
}

/** Commentary block carrying the post text body. */
interface GraphQLCommentary {
  text?: GraphQLTextAccessibility;
  numLines?: number;
}

/** Content block -- component-based; only non-null key matters. */
interface GraphQLContent {
  articleComponent?: GraphQLContentComponent;
  imageComponent?: GraphQLContentComponent;
  linkedInVideoComponent?: GraphQLContentComponent;
  documentComponent?: GraphQLContentComponent;
  externalVideoComponent?: GraphQLContentComponent;
  [key: string]: GraphQLContentComponent | null | undefined;
}

interface GraphQLContentComponent {
  navigationUrl?: string;
  [key: string]: unknown;
}

/** Pagination info. */
interface GraphQLPaging {
  start?: number;
  count?: number;
  total?: number;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract hashtags from post text.
 */
function extractHashtags(text: string | null): string[] {
  if (!text) return [];
  const matches = text.match(/#[\w\u00C0-\u024F]+/g);
  return matches ? [...new Set(matches.map((t) => t.slice(1)))] : [];
}

/**
 * Infer media type from the GraphQL content block.
 *
 * The content object has a component-based layout where only one key is
 * non-null (e.g. `imageComponent`, `linkedInVideoComponent`).
 */
function inferMediaType(content: GraphQLContent | undefined): string | null {
  if (!content) return null;

  for (const key of Object.keys(content)) {
    if (content[key] == null) continue;

    const lower = key.toLowerCase();
    if (lower.includes("image")) return "image";
    if (lower.includes("video")) return "video";
    if (lower.includes("article")) return "article";
    if (lower.includes("document")) return "document";
  }

  return null;
}

/**
 * Build a LinkedIn post URL from an activity URN.
 */
function buildPostUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

/**
 * Parse the GraphQL profile-updates response into normalised FeedPost entries.
 *
 * @internal Exported for testing only.
 */
export function parseProfileUpdatesResponse(
  raw: GraphQLProfileUpdatesResponse,
): {
  posts: FeedPost[];
  paging: { start: number; count: number; total: number };
} {
  const collection =
    raw.data?.data?.feedDashProfileUpdatesByProfileUpdates ??
    raw.data?.data?.feedDashProfileUpdatesByMemberShareFeed ??
    raw.data?.feedDashProfileUpdatesByProfileUpdates ??
    raw.data?.feedDashProfileUpdatesByMemberShareFeed;
  const paging = collection?.paging;

  // Resolve elements: prefer inline `elements`, fall back to `*elements` URN
  // references resolved against the top-level `included` array (Rest.li protocol).
  let elements = collection?.elements ?? [];
  if (elements.length === 0) {
    const refs = collection?.["*elements"] ?? [];
    const included = raw.included ?? [];
    if (refs.length > 0 && included.length > 0) {
      const byUrn = new Map<string, GraphQLProfileUpdateElement>();
      for (const e of included) {
        if (e.entityUrn) byUrn.set(e.entityUrn, e);
      }
      elements = refs
        .map((urn) => byUrn.get(urn))
        .filter((e): e is GraphQLProfileUpdateElement => e !== undefined);
    }
  }

  const posts: FeedPost[] = [];

  for (const el of elements) {
    const urn = el.metadata?.backendUrn;
    if (!urn) continue;

    // Post URL -- prefer shareUrl when available, fall back to constructed URL
    const url = el.socialContent?.shareUrl ?? buildPostUrl(urn);

    // Author info from the header block
    const authorName = el.header?.text?.text ?? null;
    const authorHeadline =
      el.header?.image?.accessibilityText ?? null;
    const authorProfileUrl = el.header?.navigationUrl ?? null;

    // Post text from the commentary block
    const text = el.commentary?.text?.text ?? null;

    // Media type from the content component block
    const mediaType = inferMediaType(el.content);

    // Hashtags
    const hashtags = extractHashtags(text);

    posts.push({
      urn,
      url,
      authorName,
      authorHeadline,
      authorProfileUrl,
      authorPublicId: null,
      text,
      mediaType,
      reactionCount: 0,
      commentCount: 0,
      shareCount: 0,
      timestamp: null,
      hashtags,
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
 * Voyager GraphQL profileUpdates API to get the profile's recent
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
    await voyager.enable();

    try {
      // If the browser is already on the activity page, LinkedIn's SPA won't
      // fire a fresh API request on navigate.  Navigate away first.
      await navigateAwayIf(client, "/recent-activity/");

      // Set up the response listener before navigation to avoid race conditions.
      // The filter matches the query name prefix, ignoring the rotating hash suffix.
      const responsePromise = voyager.waitForResponse((url) =>
        url.includes("voyagerFeedDashProfileUpdates"),
      );

      // Navigate to the profile's recent-activity page — the page makes the
      // Voyager API call with its own current queryId hash.
      const activityUrl = `https://www.linkedin.com/in/${encodeURIComponent(profilePublicId)}/recent-activity/all/`;
      await client.navigate(activityUrl);

      const response = await responsePromise;
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
        body as GraphQLProfileUpdatesResponse,
      );

      return {
        profilePublicId,
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
