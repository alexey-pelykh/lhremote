// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Detailed data for a single LinkedIn post.
 */
export interface PostDetail {
  /** The resolved post URN (e.g. `urn:li:activity:1234567890`). */
  readonly postUrn: string;
  /** Author display name. */
  readonly authorName: string;
  /** Author professional headline. */
  readonly authorHeadline: string | null;
  /** Author LinkedIn public profile ID (vanity URL slug), if available. */
  readonly authorPublicId: string | null;
  /** Post text content. */
  readonly text: string;
  /** Epoch milliseconds when the post was published, if available. */
  readonly publishedAt: number | null;
  /** Total number of reactions. */
  readonly reactionCount: number;
  /** Total number of comments. */
  readonly commentCount: number;
  /** Total number of shares/reposts. */
  readonly shareCount: number;
}

/**
 * A comment on a LinkedIn post.
 */
export interface PostComment {
  /** Comment URN identifier. */
  readonly commentUrn: string | null;
  /** Author display name. */
  readonly authorName: string;
  /** Author professional headline. */
  readonly authorHeadline: string | null;
  /** Author LinkedIn public profile ID (vanity URL slug), if available. */
  readonly authorPublicId: string | null;
  /** Comment text content. */
  readonly text: string;
  /** Epoch milliseconds when the comment was created, if available. */
  readonly createdAt: number | null;
  /** Number of reactions on this comment. */
  readonly reactionCount: number;
}
