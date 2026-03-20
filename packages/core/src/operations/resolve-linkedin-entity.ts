// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { EntityMatch, EntityType } from "../types/linkedin-url.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for resolving a human-readable name to LinkedIn entity IDs.
 */
export interface ResolveLinkedInEntityInput extends ConnectionOptions {
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
  /** Which resolution strategy was used. */
  readonly strategy: "public" | "voyager";
}

/**
 * Public typeahead endpoint (no auth required).
 *
 * Works for COMPANY and GEO entity types.
 */
const PUBLIC_TYPEAHEAD_URL =
  "https://www.linkedin.com/jobs-guest/api/typeaheadHits";

/**
 * Map our entity types to public typeahead's `typeaheadType` param.
 */
const PUBLIC_TYPEAHEAD_TYPE: Partial<Record<EntityType, string>> = {
  COMPANY: "COMPANY",
  GEO: "GEO",
};

/**
 * Map our entity types to Voyager's `type` param.
 */
const VOYAGER_TYPE: Record<EntityType, string> = {
  COMPANY: "COMPANY",
  GEO: "GEO",
  SCHOOL: "SCHOOL",
};

/**
 * Try the public typeahead endpoint first.
 *
 * @returns Matches, or `undefined` if the public endpoint is not
 *          available for this entity type or the request fails.
 */
async function tryPublicTypeahead(
  query: string,
  entityType: EntityType,
): Promise<EntityMatch[] | undefined> {
  const typeaheadType = PUBLIC_TYPEAHEAD_TYPE[entityType];
  if (typeaheadType === undefined) return undefined;

  const url = new URL(PUBLIC_TYPEAHEAD_URL);
  url.searchParams.set("typeaheadType", typeaheadType);
  url.searchParams.set("query", query);

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return undefined;

    const data = (await response.json()) as PublicTypeaheadResponse;
    return parsePublicTypeaheadResponse(data, entityType);
  } catch {
    return undefined;
  }
}

/** Shape of the public typeahead API response. */
interface PublicTypeaheadResponse {
  elements?: Array<{
    hitInfo?: {
      id?: string;
      displayName?: string;
      companyName?: string;
      locationName?: string;
    };
  }>;
}

/**
 * Parse the public typeahead response into normalised matches.
 */
function parsePublicTypeaheadResponse(
  data: PublicTypeaheadResponse,
  entityType: EntityType,
): EntityMatch[] {
  if (!data.elements) return [];

  return data.elements
    .filter((el): el is typeof el & { hitInfo: { id: string } } =>
      el.hitInfo?.id !== undefined,
    )
    .map((el) => ({
      id: el.hitInfo.id,
      name:
        el.hitInfo?.displayName ??
        el.hitInfo?.companyName ??
        el.hitInfo?.locationName ??
        "",
      type: entityType,
    }))
    .slice(0, 10);
}

/**
 * Try the Voyager typeahead endpoint via CDP.
 *
 * Connects to the LinkedIn webview in LinkedHelper and executes
 * the Voyager request from within the page context (which has
 * the LinkedIn session cookies).
 */
async function tryVoyagerTypeahead(
  query: string,
  entityType: EntityType,
  cdpPort: number,
  cdpHost: string,
  allowRemote: boolean,
): Promise<EntityMatch[]> {
  // Find the LinkedIn page target
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

  const client = new CDPClient(cdpPort, {
    host: cdpHost,
    allowRemote,
  });
  await client.connect(linkedInTarget.id);

  try {
    // Execute the Voyager typeahead request from within the LinkedIn page
    // context where session cookies are already available.
    const voyagerType = VOYAGER_TYPE[entityType];
    const result = await client.evaluate<VoyagerEvalResult>(
      `(async () => {
        const params = new URLSearchParams({
          type: ${JSON.stringify(voyagerType)},
          keywords: ${JSON.stringify(query)},
          q: "type",
          origin: "OTHER",
        });
        const url = "https://www.linkedin.com/voyager/api/typeahead/hitsV2?" + params;

        // Extract CSRF token from cookies. The JSESSIONID value is
        // typically stored as "ajax:<token>" (with quotes); strip quotes
        // and use as-is for the Csrf-Token header.
        const jsessionid = document.cookie
          .split(";")
          .map(c => c.trim())
          .find(c => c.startsWith("JSESSIONID="));
        let csrfToken = jsessionid
          ? jsessionid.substring(jsessionid.indexOf("=") + 1).replace(/"/g, "")
          : "";
        // Ensure "ajax:" prefix is present exactly once
        if (!csrfToken.startsWith("ajax:")) {
          csrfToken = "ajax:" + csrfToken;
        }

        const response = await fetch(url, {
          headers: {
            "Csrf-Token": csrfToken,
            "X-RestLi-Protocol-Version": "2.0.0",
          },
          credentials: "include",
        });

        if (!response.ok) {
          return { error: "HTTP " + response.status + ": " + response.statusText };
        }

        const data = await response.json();
        return { data };
      })()`,
    );

    if (result.error) {
      throw new Error(`Voyager typeahead request failed: ${result.error}`);
    }

    return parseVoyagerResponse(result.data, entityType);
  } finally {
    client.disconnect();
  }
}

/** Shape returned by the evaluate expression. */
interface VoyagerEvalResult {
  error?: string;
  data?: VoyagerTypeaheadResponse;
}

/** Shape of the Voyager typeahead API response. */
interface VoyagerTypeaheadResponse {
  elements?: Array<{
    targetUrn?: string;
    title?: { text?: string };
    trackingUrn?: string;
  }>;
}

/**
 * Parse the Voyager typeahead response into normalised matches.
 */
function parseVoyagerResponse(
  data: VoyagerTypeaheadResponse | undefined,
  entityType: EntityType,
): EntityMatch[] {
  if (!data?.elements) return [];

  return data.elements
    .filter((el) => el.targetUrn !== undefined || el.trackingUrn !== undefined)
    .map((el) => {
      // Extract numeric ID from URN (e.g., "urn:li:organization:1441" → "1441")
      const urn = el.targetUrn ?? el.trackingUrn ?? "";
      const id = urn.split(":").pop() ?? urn;

      return {
        id,
        name: el.title?.text ?? "",
        type: entityType,
      };
    })
    .slice(0, 10);
}

/**
 * Resolve human-readable names (company names, locations, schools) to
 * LinkedIn entity IDs via typeahead endpoints.
 *
 * Two-strategy approach:
 * 1. **Public typeahead** (primary for COMPANY/GEO) — no auth required
 * 2. **Voyager typeahead** (fallback, primary for SCHOOL) — requires CDP
 *
 * @param input - Resolution parameters
 * @returns Resolved matches with strategy used
 */
export async function resolveLinkedInEntity(
  input: ResolveLinkedInEntityInput,
): Promise<ResolveLinkedInEntityOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;

  // For SCHOOL, public endpoint doesn't support it — go straight to Voyager
  if (input.entityType === "SCHOOL") {
    const matches = await tryVoyagerTypeahead(
      input.query,
      input.entityType,
      cdpPort,
      cdpHost,
      allowRemote,
    );
    return { matches, strategy: "voyager" };
  }

  // Try public endpoint first — only fall back to Voyager if the request
  // itself failed (undefined), not when it succeeded with zero matches.
  const publicMatches = await tryPublicTypeahead(
    input.query,
    input.entityType,
  );
  if (publicMatches !== undefined) {
    return { matches: publicMatches, strategy: "public" };
  }

  // Public endpoint failed — fallback to Voyager
  const voyagerMatches = await tryVoyagerTypeahead(
    input.query,
    input.entityType,
    cdpPort,
    cdpHost,
    allowRemote,
  );
  return { matches: voyagerMatches, strategy: "voyager" };
}
