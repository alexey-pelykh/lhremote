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
// GraphQL feed response shapes
// ---------------------------------------------------------------------------

/** Top-level GraphQL response wrapper. */
interface GraphQLFeedResponse {
  data?: {
    /** LinkedIn sometimes wraps GraphQL responses in a nested `data` object. */
    data?: {
      feedDashMainFeedByMainFeed?: GraphQLFeedCollection;
    };
    feedDashMainFeedByMainFeed?: GraphQLFeedCollection;
  };
  /** Rest.li included entities — resolved via `*elements` URN references. */
  included?: GraphQLFeedElement[];
}

/** The collection returned by the feedDashMainFeedByMainFeed query. */
interface GraphQLFeedCollection {
  /** Inline elements (active fetch mode). */
  elements?: GraphQLFeedElement[];
  /** URN references to entities in the top-level `included` array (passive interception). */
  "*elements"?: string[];
  metadata?: GraphQLCollectionMetadata;
  paging?: GraphQLPaging;
}

/** Per-element metadata carrying the activity URN and share URL. */
interface GraphQLElementMetadata {
  backendUrn?: string;
  shareUrn?: string;
}

/** Social content block on each feed element. */
interface GraphQLSocialContent {
  shareUrl?: string;
}

/** A single feed element from the GraphQL endpoint. */
interface GraphQLFeedElement {
  /** Entity URN — present when resolved from the `included` array. */
  entityUrn?: string;
  metadata?: GraphQLElementMetadata;
  socialContent?: GraphQLSocialContent;
  header?: GraphQLHeader;
  commentary?: GraphQLCommentary;
  content?: GraphQLContent;
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

/** Content block – component-based; only non-null key matters. */
interface GraphQLContent {
  "com.linkedin.voyager.dash.feed.ArticleComponent"?: GraphQLContentComponent;
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

/** Pagination metadata from the collection. */
interface GraphQLCollectionMetadata {
  paginationToken?: string;
}

/** Paging info. */
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
 * Parse the GraphQL feed response into normalised FeedPost entries.
 */
function parseFeedResponse(raw: GraphQLFeedResponse): {
  posts: FeedPost[];
  nextCursor: string | null;
} {
  const collection =
    raw.data?.data?.feedDashMainFeedByMainFeed ??
    raw.data?.feedDashMainFeedByMainFeed;
  const metadata = collection?.metadata;

  // Resolve elements: prefer inline `elements`, fall back to `*elements` URN
  // references resolved against the top-level `included` array (Rest.li protocol).
  let elements = collection?.elements ?? [];
  if (elements.length === 0) {
    const refs = collection?.["*elements"] ?? [];
    const included = raw.included ?? [];
    if (refs.length > 0 && included.length > 0) {
      const byUrn = new Map<string, GraphQLFeedElement>();
      for (const e of included) {
        if (e.entityUrn) byUrn.set(e.entityUrn, e);
      }
      elements = refs
        .map((urn) => byUrn.get(urn))
        .filter((e): e is GraphQLFeedElement => e !== undefined);
    }
  }

  const posts: FeedPost[] = [];

  for (const el of elements) {
    const urn = el.metadata?.backendUrn;
    if (!urn) continue;

    // Post URL – prefer shareUrl when available, fall back to constructed URL
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

  const nextCursor = metadata?.paginationToken ?? null;

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
        url.includes("voyagerFeedDashMainFeed"),
      );

      await client.navigate("https://www.linkedin.com/feed/");

      const response = await responsePromise;
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

      const parsed = parseFeedResponse(body as GraphQLFeedResponse);

      return {
        posts: parsed.posts,
        nextCursor: parsed.nextCursor,
      };
    } finally {
      await voyager.disable();
    }
  } finally {
    client.disconnect();
  }
}
