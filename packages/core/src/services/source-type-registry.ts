// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { SourceType } from "../types/collection.js";

/**
 * URL pattern entry mapping a regex to a source type.
 */
interface SourceTypePattern {
  pattern: RegExp;
  sourceType: SourceType;
}

/**
 * Ordered list of URL patterns for source type detection.
 *
 * Patterns are tested in order; the first match wins.
 */
const SOURCE_TYPE_PATTERNS: SourceTypePattern[] = [
  { pattern: /\/search\/results\/people\//, sourceType: "SearchPage" },
  { pattern: /\/mynetwork\/invite-connect\/connections\//, sourceType: "MyConnections" },
  { pattern: /\/school\/[^/]+\/people\//, sourceType: "Alumni" },
  { pattern: /\/company\/[^/]+\/people\//, sourceType: "OrganizationPeople" },
  { pattern: /\/groups\/[^/]+\/members\//, sourceType: "Group" },
  { pattern: /\/events\/[^/]+\/attendees\//, sourceType: "Event" },
  { pattern: /\/me\/profile-views\//, sourceType: "LWVYPP" },
  { pattern: /\/mynetwork\/invitation-manager\/sent\//, sourceType: "SentInvitationPage" },
  { pattern: /\/me\/my-network\/followers\//, sourceType: "FollowersPage" },
  { pattern: /\/me\/my-network\/following\//, sourceType: "FollowingPage" },
  { pattern: /\/sales\/search\/people/, sourceType: "SNSearchPage" },
  { pattern: /\/sales\/lists\/people\//, sourceType: "SNListPage" },
  { pattern: /\/sales\/search\/company/, sourceType: "SNOrgsPage" },
  { pattern: /\/sales\/lists\/company\//, sourceType: "SNOrgsListsPage" },
  { pattern: /\/talent\/search\//, sourceType: "TSearchPage" },
  { pattern: /\/talent\/projects\//, sourceType: "TProjectPage" },
  { pattern: /\/recruiter\/search\//, sourceType: "RSearchPage" },
  { pattern: /\/recruiter\/projects\//, sourceType: "RProjectPage" },
];

/**
 * Set of all valid source type strings for fast validation.
 */
const VALID_SOURCE_TYPES: ReadonlySet<string> = new Set<string>(
  SOURCE_TYPE_PATTERNS.map((entry) => entry.sourceType),
);

/**
 * Detect the LinkedIn source type from a URL.
 *
 * Tests the URL pathname against known LinkedIn page patterns and
 * returns the matching source type, or `undefined` if no pattern matches.
 *
 * @param url - Full LinkedIn URL or pathname
 * @returns The detected source type, or `undefined` for unknown URLs
 */
export function detectSourceType(url: string): SourceType | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Treat non-URL strings as raw pathnames
    pathname = url;
  }

  for (const { pattern, sourceType } of SOURCE_TYPE_PATTERNS) {
    if (pattern.test(pathname)) {
      return sourceType;
    }
  }

  return undefined;
}

/**
 * Validate whether a string is a known source type.
 *
 * @param type - String to validate
 * @returns `true` if `type` is a valid {@link SourceType}
 */
export function validateSourceType(type: string): type is SourceType {
  return VALID_SOURCE_TYPES.has(type);
}
