// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { SourceType } from "../types/collection.js";

/**
 * Fixed LinkedIn URLs that require no parameters.
 */
const FIXED_URLS: Partial<Record<SourceType, string>> = {
  MyConnections:
    "https://www.linkedin.com/mynetwork/invite-connect/connections/",
  LWVYPP: "https://www.linkedin.com/me/profile-views/",
  SentInvitationPage:
    "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
  FollowersPage: "https://www.linkedin.com/me/my-network/followers/",
  FollowingPage: "https://www.linkedin.com/me/my-network/following/",
  SNOrgsPage: "https://www.linkedin.com/sales/search/company",
  TSearchPage: "https://www.linkedin.com/talent/search/",
  RSearchPage: "https://www.linkedin.com/recruiter/search/",
};

/**
 * Parameterised URL templates.
 *
 * - `{slug}` is replaced with the provided slug string.
 * - `{id}` is replaced with the provided ID string.
 */
const PARAMETERISED_TEMPLATES: Partial<
  Record<SourceType, { template: string; param: "slug" | "id" }>
> = {
  OrganizationPeople: {
    template: "https://www.linkedin.com/company/{slug}/people/",
    param: "slug",
  },
  Alumni: {
    template: "https://www.linkedin.com/school/{slug}/people/",
    param: "slug",
  },
  Group: {
    template: "https://www.linkedin.com/groups/{id}/members/",
    param: "id",
  },
  Event: {
    template: "https://www.linkedin.com/events/{id}/attendees/",
    param: "id",
  },
  SNListPage: {
    template: "https://www.linkedin.com/sales/lists/people/{id}/",
    param: "id",
  },
  SNOrgsListsPage: {
    template: "https://www.linkedin.com/sales/lists/company/{id}/",
    param: "id",
  },
  TProjectPage: {
    template: "https://www.linkedin.com/talent/projects/{id}/",
    param: "id",
  },
  RProjectPage: {
    template: "https://www.linkedin.com/recruiter/projects/{id}/",
    param: "id",
  },
};

/** Source types that use the basic search URL builder. */
const SEARCH_BUILDER_TYPES: ReadonlySet<SourceType> = new Set(["SearchPage"]);

/** Source types that use the SN search URL builder. */
const SN_SEARCH_BUILDER_TYPES: ReadonlySet<SourceType> = new Set([
  "SNSearchPage",
]);

/**
 * Check whether a source type uses a fixed URL (no parameters needed).
 */
export function isFixedUrlType(sourceType: SourceType): boolean {
  return sourceType in FIXED_URLS;
}

/**
 * Check whether a source type uses a parameterised template.
 */
export function isParameterisedType(sourceType: SourceType): boolean {
  return sourceType in PARAMETERISED_TEMPLATES;
}

/**
 * Check whether a source type uses the basic search URL builder.
 */
export function isSearchBuilderType(sourceType: SourceType): boolean {
  return SEARCH_BUILDER_TYPES.has(sourceType);
}

/**
 * Check whether a source type uses the Sales Navigator URL builder.
 */
export function isSNSearchBuilderType(sourceType: SourceType): boolean {
  return SN_SEARCH_BUILDER_TYPES.has(sourceType);
}

/**
 * Get the fixed URL for a source type.
 *
 * @returns The URL, or `undefined` if the source type is not a fixed URL type.
 */
export function getFixedUrl(sourceType: SourceType): string | undefined {
  return FIXED_URLS[sourceType];
}

/**
 * Build a parameterised URL for a source type.
 *
 * @param sourceType - The source type to build a URL for.
 * @param params - The slug or ID to substitute.
 * @returns The built URL, or `undefined` if the source type is not parameterised.
 */
export function buildParameterisedUrl(
  sourceType: SourceType,
  params: { slug?: string; id?: string },
): string | undefined {
  const entry = PARAMETERISED_TEMPLATES[sourceType];
  if (entry === undefined) return undefined;

  const value =
    entry.param === "slug" ? params.slug : params.id;
  if (value === undefined) return undefined;

  return entry.template.replace(`{${entry.param}}`, encodeURIComponent(value));
}

/**
 * Get the required parameter type for a parameterised source type.
 *
 * @returns `"slug"`, `"id"`, or `undefined` if not a parameterised type.
 */
export function getParameterType(
  sourceType: SourceType,
): "slug" | "id" | undefined {
  return PARAMETERISED_TEMPLATES[sourceType]?.param;
}
