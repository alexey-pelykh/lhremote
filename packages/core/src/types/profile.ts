// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Core people/profile types derived from LinkedHelper's SQLite schema.
 *
 * Root entity: `people` table (1:1 with mini-profile, 1:N with positions,
 * education, skills, emails, external IDs).
 */

export interface MiniProfile {
  firstName: string;
  lastName: string | null;
  headline: string | null;
  avatar: string | null;
}

export type ExternalIdTypeGroup = "member" | "public" | "hash" | "avatar";

export interface ExternalId {
  externalId: string;
  typeGroup: ExternalIdTypeGroup;
  isMemberId: boolean;
}

export interface Position {
  company: string | null;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}

export interface CurrentPosition {
  company: string | null;
  title: string | null;
}

export interface Education {
  school: string | null;
  degree: string | null;
  field: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface Skill {
  name: string;
}

export interface Profile {
  id: number;
  miniProfile: MiniProfile;
  externalIds: ExternalId[];
  currentPosition: CurrentPosition | null;
  positions: Position[];
  education: Education[];
  skills: Skill[];
  emails: string[];
}

/**
 * Options for searching profiles in the local database.
 */
export interface ProfileSearchOptions {
  /** Match against first_name, last_name, headline */
  query?: string;
  /** Match against current position company */
  company?: string;
  /** Maximum number of results (default 20) */
  limit?: number;
  /** Pagination offset (default 0) */
  offset?: number;
}

/**
 * Summary of a profile for search results.
 */
export interface ProfileSummary {
  id: number;
  firstName: string;
  lastName: string | null;
  headline: string | null;
  company: string | null;
  title: string | null;
}

/**
 * Result of a profile search operation.
 */
export interface ProfileSearchResult {
  profiles: ProfileSummary[];
  total: number;
}
