// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Engagement statistics for a LinkedIn post.
 */
export interface PostStats {
  /** The resolved post URN (e.g. `urn:li:activity:1234567890`). */
  readonly postUrn: string;
  /** Total number of reactions. */
  readonly reactionCount: number;
  /** Reactions broken down by type. */
  readonly reactionsByType: readonly ReactionCount[];
  /** Total number of comments. */
  readonly commentCount: number;
  /** Total number of shares/reposts. */
  readonly shareCount: number;
}

/**
 * Reaction count for a specific reaction type.
 */
export interface ReactionCount {
  /** LinkedIn reaction type (e.g. `LIKE`, `PRAISE`, `EMPATHY`, `ENTERTAINMENT`, `INTEREST`, `APPRECIATION`). */
  readonly type: string;
  /** Number of reactions of this type. */
  readonly count: number;
}

/**
 * A person who engaged with a post (reacted, commented, etc.).
 */
export interface PostEngager {
  /** First name of the engager. */
  readonly firstName: string;
  /** Last name of the engager. */
  readonly lastName: string;
  /** LinkedIn public profile ID (vanity URL slug), if available. */
  readonly publicId: string | null;
  /** Professional headline. */
  readonly headline: string | null;
  /** Engagement type (e.g. `LIKE`, `PRAISE`, `EMPATHY`). */
  readonly engagementType: string;
}
