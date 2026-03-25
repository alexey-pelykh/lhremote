// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { PostComment, PostDetail } from "../types/post.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { VoyagerInterceptor } from "../voyager/interceptor.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";
import { extractPostUrn } from "./get-post-stats.js";
import { navigateAwayIf } from "./navigate-away.js";
import { delay } from "./get-feed.js";

/**
 * Input for the get-post operation.
 */
export interface GetPostInput extends ConnectionOptions {
  /** LinkedIn post URL or raw URN (e.g. `urn:li:activity:1234567890`). */
  readonly postUrl: string;
  /** Maximum number of comments to load (default: 10). */
  readonly commentCount?: number | undefined;
}

/**
 * Output from the get-post operation.
 */
export interface GetPostOutput {
  /** Full post detail. */
  readonly post: PostDetail;
  /** Comments on this post (scraped from the rendered page). */
  readonly comments: PostComment[];
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
// DOM comment scraping
// ---------------------------------------------------------------------------

/** Shape returned by the in-page comment scraping script. */
interface RawDomComment {
  authorName: string;
  authorHeadline: string | null;
  authorPublicId: string | null;
  text: string;
  createdAt: number | null;
  reactionCount: number;
}

/**
 * JavaScript source evaluated inside the LinkedIn page context to scrape
 * visible comments from the post detail page.
 */
export const SCRAPE_COMMENTS_SCRIPT = `(() => {
  const comments = [];

  // LinkedIn renders comments as article elements within the comments section.
  // Each comment item contains author info, text, and engagement data.
  const items = document.querySelectorAll(
    'article.comments-comment-item,' +
    'article.comments-comment-entity,' +
    'div[class*="comments-comment-item"],' +
    'div[class*="comments-comment-entity"]'
  );

  for (const item of items) {
    // --- Author ---
    let authorName = '';
    let authorHeadline = null;
    let authorPublicId = null;

    const profileLink = item.querySelector('a[href*="/in/"]');
    if (profileLink) {
      const match = profileLink.href.match(/\\/in\\/([^/?]+)/);
      if (match) authorPublicId = match[1];
      const nameEl = profileLink.querySelector('span[dir="ltr"], span[aria-hidden="true"]')
        || profileLink;
      authorName = (nameEl.textContent || '').trim();
    }

    // Headline — secondary text near author name
    const headlineEl = item.querySelector(
      'span.comments-post-meta__headline,' +
      'span[class*="comment-item__subtitle"],' +
      'span.t-12.t-normal'
    );
    if (headlineEl) {
      const txt = (headlineEl.textContent || '').trim();
      if (txt && txt !== authorName) authorHeadline = txt;
    }

    // --- Comment text ---
    const textEl = item.querySelector(
      'span.comments-comment-item__main-content,' +
      'span[class*="comment-item__main-content"],' +
      'span[dir="ltr"].break-words'
    );
    const text = textEl ? (textEl.textContent || '').trim() : '';

    // --- Timestamp ---
    let createdAt = null;
    const timeEl = item.querySelector('time');
    if (timeEl) {
      const dt = timeEl.getAttribute('datetime');
      if (dt) {
        const ms = Date.parse(dt);
        if (!isNaN(ms)) createdAt = ms;
      }
    }

    // --- Reaction count ---
    let reactionCount = 0;
    const itemText = item.textContent || '';
    const likeMatch = itemText.match(/(\\d[\\d,]*)\\s+reactions?/i)
      || itemText.match(/(\\d[\\d,]*)\\s+likes?/i);
    if (likeMatch) {
      reactionCount = parseInt(likeMatch[1].replace(/,/g, ''), 10) || 0;
    }

    if (text || authorName) {
      comments.push({
        authorName: authorName,
        authorHeadline: authorHeadline,
        authorPublicId: authorPublicId,
        text: text,
        createdAt: createdAt,
        reactionCount: reactionCount,
      });
    }
  }

  return comments;
})()`;

/**
 * JavaScript source that clicks a "load more comments" button if present.
 * Returns true if a button was clicked, false otherwise.
 */
export const CLICK_LOAD_MORE_COMMENTS_SCRIPT = `(() => {
  // LinkedIn uses various button patterns for loading more comments
  const selectors = [
    'button.comments-comments-list__load-more-comments-button',
    'button[class*="load-more-comments"]',
    'button[class*="show-previous-comments"]',
    'button[class*="comments-load-more"]',
  ];

  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
  }

  // Fallback: look for any button whose text suggests loading more comments
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const text = (btn.textContent || '').trim().toLowerCase();
    if (
      (text.includes('load') || text.includes('show') || text.includes('more') || text.includes('previous')) &&
      text.includes('comment') &&
      !btn.disabled
    ) {
      btn.click();
      return true;
    }
  }

  return false;
})()`;

/** Convert raw DOM comment to PostComment. */
function mapDomComment(c: RawDomComment): PostComment {
  return {
    commentUrn: null,
    authorName: c.authorName,
    authorHeadline: c.authorHeadline,
    authorPublicId: c.authorPublicId,
    text: c.text,
    createdAt: c.createdAt,
    reactionCount: c.reactionCount,
  };
}

/** Timeout for intercepting a comment-loading response after clicking load-more (ms). */
const COMMENT_RESPONSE_TIMEOUT = 10_000;

/**
 * Load comments from the post detail page.
 *
 * 1. Scrape initial visible comments from the DOM.
 * 2. If more are needed, click "load more" and intercept the comment-loading
 *    Voyager response (organic request triggered by the UI click).
 * 3. Repeat until `maxComments` is reached or no more are available.
 */
async function loadComments(
  client: CDPClient,
  voyager: VoyagerInterceptor,
  maxComments: number,
): Promise<PostComment[]> {
  // Scrape comments already visible on the page
  const initial = await client.evaluate<RawDomComment[]>(SCRAPE_COMMENTS_SCRIPT);
  const comments: PostComment[] = (initial ?? []).map(mapDomComment);

  if (comments.length >= maxComments) {
    return comments.slice(0, maxComments);
  }

  // Click "load more" and intercept responses until we have enough
  const maxLoadAttempts = 10;

  for (let attempt = 0; attempt < maxLoadAttempts; attempt++) {
    const clicked = await client.evaluate<boolean>(
      CLICK_LOAD_MORE_COMMENTS_SCRIPT,
    );
    if (!clicked) break;

    // Try to intercept the comment-loading Voyager response triggered by the click.
    // LinkedIn fires a request to a comments endpoint (e.g. /feedComments or
    // similar) — we intercept it for structured data rather than DOM-scraping.
    try {
      const response = await voyager.waitForResponse(
        (url) => url.includes("/comments") || url.includes("Comments"),
        COMMENT_RESPONSE_TIMEOUT,
      );

      if (
        response.status === 200 &&
        response.body !== null &&
        typeof response.body === "object"
      ) {
        const parsed = parseCommentsResponse(
          response.body as VoyagerCommentsResponse,
        );
        for (const c of parsed.comments) {
          comments.push(c);
        }
      }
    } catch {
      // Timeout or error — fall back to DOM scraping.
      // The DOM should now contain any comments the UI loaded after the
      // click.  Only adopt the DOM set if it grew beyond what we already
      // have (avoids losing previously intercepted structured data).
      await delay(1500);
      const scraped = await client.evaluate<RawDomComment[]>(
        SCRAPE_COMMENTS_SCRIPT,
      );
      const fresh = (scraped ?? []).map(mapDomComment);
      if (fresh.length > comments.length) {
        comments.length = 0;
        comments.push(...fresh);
      }
    }

    if (comments.length >= maxComments) {
      return comments.slice(0, maxComments);
    }
  }

  return comments.slice(0, maxComments);
}

// ---------------------------------------------------------------------------
// Main operation
// ---------------------------------------------------------------------------

/**
 * Retrieve detailed data for a single LinkedIn post with its comment thread.
 *
 * Connects to the LinkedIn webview in LinkedHelper, navigates to the
 * post detail page, and passively intercepts the REST `/feed/updates/{urn}`
 * response to extract post content.  Comments are loaded by scraping
 * initial visible comments and then clicking "load more" — intercepting
 * each comment-loading response for structured data.
 *
 * @param input - Post URL or URN, comment limit, and CDP connection options.
 * @returns Post detail with comments.
 */
export async function getPost(input: GetPostInput): Promise<GetPostOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const commentCount = input.commentCount ?? 10;

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
      // If the browser is already on the post detail page, LinkedIn's SPA
      // won't fire a fresh API request on navigate.  Navigate away first.
      await navigateAwayIf(client, "/feed/update/");

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
          `Voyager API returned HTTP ${String(response.status)} for post detail`,
        );
      }

      const body = response.body;
      if (body === null || typeof body !== "object") {
        throw new Error(
          "Voyager API returned an unexpected response format for post detail",
        );
      }

      const rawPost = body as VoyagerFeedUpdateResponse;
      const included = rawPost.included ?? [];

      const post = parseFeedUpdateResponse(rawPost, postUrn, included);

      // Load comments: scrape initial visible comments from the DOM, then
      // click "load more" and intercept each comment-loading response.
      const comments = await loadComments(client, voyager, commentCount);

      return { post, comments };
    } finally {
      await voyager.disable();
    }
  } finally {
    client.disconnect();
  }
}
