// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * A LinkedIn post returned from a content search.
 */
export interface SearchPostResult {
  /** Post URN (e.g. `urn:li:activity:1234567890`). */
  readonly postUrn: string;
  /** Post text content (may be truncated by API). */
  readonly text: string | null;
  /** Author first name. */
  readonly authorFirstName: string | null;
  /** Author last name. */
  readonly authorLastName: string | null;
  /** Author LinkedIn public ID (vanity URL slug). */
  readonly authorPublicId: string | null;
  /** Author professional headline. */
  readonly authorHeadline: string | null;
  /** Total number of reactions on the post. */
  readonly reactionCount: number;
  /** Total number of comments on the post. */
  readonly commentCount: number;
}
