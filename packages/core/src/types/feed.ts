// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * A post from the LinkedIn home feed or profile activity stream.
 */
export interface FeedPost {
  /** Direct URL to the post on LinkedIn. */
  readonly url: string;
  /** Display name of the post author. */
  readonly authorName: string | null;
  /** Professional headline of the author, if available. */
  readonly authorHeadline: string | null;
  /** URL to the author's LinkedIn profile, if available. */
  readonly authorProfileUrl: string | null;
  /** Author LinkedIn public ID (vanity URL slug), if available. */
  readonly authorPublicId: string | null;
  /** Text content of the post, if any. */
  readonly text: string | null;
  /** Type of media attached to the post (e.g. `image`, `video`, `article`, `document`), if any. */
  readonly mediaType: string | null;
  /** Total number of reactions on the post. */
  readonly reactionCount: number;
  /** Total number of comments on the post. */
  readonly commentCount: number;
  /** Total number of shares/reposts. */
  readonly shareCount: number;
  /** Post creation timestamp in milliseconds since epoch, if available. */
  readonly timestamp: number | null;
  /** Hashtags extracted from the post text. */
  readonly hashtags: readonly string[];
}
