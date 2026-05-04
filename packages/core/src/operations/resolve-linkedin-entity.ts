// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { EntityMatch, EntityType } from "../types/linkedin-url.js";

/**
 * Input for resolving a human-readable name to LinkedIn entity IDs.
 */
export interface ResolveLinkedInEntityInput {
  /** Search query (company name, location, school name). */
  readonly query: string;
  /** Type of entity to resolve. */
  readonly entityType: EntityType;
}

/**
 * Output from entity resolution.
 */
export interface ResolveLinkedInEntityOutput {
  /** Resolved entity matches (up to 10). */
  readonly matches: EntityMatch[];
}

/**
 * Public typeahead endpoint (no auth required).
 *
 * Used by the LinkedIn Jobs guest search page; resolves COMPANY and
 * GEO entities. Schools are stored as organizations on LinkedIn — a
 * COMPANY query for "Stanford" returns Stanford University with the
 * same numeric id Voyager would surface under `urn:li:school:N`, so
 * SCHOOL queries route through the same endpoint with `typeaheadType`
 * COMPANY.
 *
 * Endpoint shape: top-level JSON array of
 * `{id, type, displayName, trackingId}`. See lhremote#763, #767, #769
 * for the empirical findings that established this contract.
 */
const PUBLIC_TYPEAHEAD_URL =
  "https://www.linkedin.com/jobs-guest/api/typeaheadHits";

/**
 * Map our entity types to the public typeahead's `typeaheadType` param.
 *
 * The endpoint silently ignores unsupported `typeaheadType` values
 * (degrades to a mixed default search instead of erroring), so SCHOOL
 * is mapped to COMPANY rather than passed through — schools resolve
 * via the COMPANY namespace anyway.
 */
const PUBLIC_TYPEAHEAD_TYPE: Record<EntityType, string> = {
  COMPANY: "COMPANY",
  GEO: "GEO",
  SCHOOL: "COMPANY",
};

/**
 * Shape of one entry in the public typeahead API response.
 *
 * The endpoint returns a top-level JSON array (not an object with an
 * `elements` field). Each entry has a flat `{id, type, displayName,
 * trackingId}` shape.
 */
interface PublicTypeaheadEntry {
  id?: string;
  type?: string;
  displayName?: string;
  trackingId?: string;
}

/**
 * Parse the public typeahead response into normalised matches.
 *
 * Accepts `unknown` and validates the array shape at runtime: the
 * upstream `response.json()` cannot be statically typed, and the
 * endpoint has shifted shape historically (the original bug in #763
 * was a parser written against an older `{elements: [...]}` shape).
 * Non-array responses throw — silently returning `[]` for shape drift
 * would recreate exactly the silent-failure mode #763 was filed for.
 */
function parsePublicTypeaheadResponse(
  data: unknown,
  entityType: EntityType,
): EntityMatch[] {
  if (!Array.isArray(data)) {
    throw new Error(
      "Public typeahead returned an unexpected response shape (expected a top-level array)",
    );
  }

  return (data as PublicTypeaheadEntry[])
    .filter((el): el is PublicTypeaheadEntry & { id: string } =>
      typeof el?.id === "string",
    )
    .map((el) => ({
      id: el.id,
      name: el.displayName ?? "",
      type: entityType,
    }))
    .slice(0, 10);
}

/**
 * Resolve human-readable names (company names, locations, schools) to
 * LinkedIn entity IDs via the public typeahead endpoint.
 *
 * No authentication, no CDP, no LinkedHelper session required — a
 * direct unauthenticated GET to LinkedIn's Jobs guest typeahead.
 *
 * Throws on:
 *   - transport (network) errors
 *   - HTTP non-2xx responses
 *   - unexpected response shape (non-array body)
 * Returns `{matches: []}` only for valid array responses with no
 * usable entries — i.e. genuine "no matches" cases.
 *
 * @param input - Resolution parameters
 * @returns Resolved matches (up to 10)
 */
export async function resolveLinkedInEntity(
  input: ResolveLinkedInEntityInput,
): Promise<ResolveLinkedInEntityOutput> {
  const typeaheadType = PUBLIC_TYPEAHEAD_TYPE[input.entityType];

  const url = new URL(PUBLIC_TYPEAHEAD_URL);
  url.searchParams.set("typeaheadType", typeaheadType);
  url.searchParams.set("query", input.query);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Public typeahead request failed: HTTP ${String(response.status)}`,
    );
  }

  const data: unknown = await response.json();
  const matches = parsePublicTypeaheadResponse(data, input.entityType);
  return { matches };
}
