// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type {
  BasicSearchParams,
  BooleanExpressionInput,
  UrlBuilderResult,
} from "../types/linkedin-url.js";
import { buildBooleanExpression } from "./boolean-expression.js";

const BASE_URL = "https://www.linkedin.com/search/results/people/";

/**
 * Parameter names that are only valid for Sales Navigator searches.
 * If passed to the basic search builder, a warning is emitted.
 */
const SN_ONLY_PARAMS: ReadonlySet<string> = new Set([
  "seniorityLevel",
  "function",
  "companyHeadcount",
  "companyType",
  "yearsAtCurrentCompany",
  "yearsAtCurrentPosition",
  "yearsOfExperience",
]);

/**
 * Resolve keywords to a string.
 *
 * Accepts either a plain string or a structured/raw boolean expression.
 */
function resolveKeywords(
  keywords: string | BooleanExpressionInput,
): string {
  if (typeof keywords === "string") return keywords;
  return buildBooleanExpression(keywords);
}

/**
 * Encode a string array as a JSON array string for LinkedIn URL params.
 *
 * LinkedIn uses `["value1","value2"]` encoding for faceted filters.
 */
function encodeJsonArray(values: string[]): string {
  return JSON.stringify(values);
}

/**
 * Build a LinkedIn basic search (`/search/results/people/`) URL.
 *
 * Handles JSON-array encoding for faceted filters and boolean
 * keyword composition.
 *
 * @param params - Search parameters
 * @returns URL and any warnings
 */
export function buildBasicSearchUrl(
  params: BasicSearchParams,
): UrlBuilderResult {
  const warnings: string[] = [];
  const searchParams = new URLSearchParams();

  // Keywords
  if (params.keywords !== undefined) {
    const keywordsStr = resolveKeywords(params.keywords);
    if (keywordsStr.length > 0) {
      searchParams.set("keywords", keywordsStr);
    }
  }

  // Faceted array filters
  const arrayFilters: Array<{
    key: string;
    urlKey: string;
    values: string[] | undefined;
  }> = [
    {
      key: "currentCompany",
      urlKey: "currentCompany",
      values: params.currentCompany,
    },
    { key: "pastCompany", urlKey: "pastCompany", values: params.pastCompany },
    { key: "geoUrn", urlKey: "geoUrn", values: params.geoUrn },
    { key: "industry", urlKey: "industry", values: params.industry },
    { key: "school", urlKey: "schoolFilter", values: params.school },
    { key: "network", urlKey: "network", values: params.network },
    {
      key: "profileLanguage",
      urlKey: "profileLanguage",
      values: params.profileLanguage,
    },
    {
      key: "serviceCategory",
      urlKey: "serviceCategory",
      values: params.serviceCategory,
    },
  ];

  for (const filter of arrayFilters) {
    if (filter.values !== undefined) {
      if (filter.values.length === 0) {
        warnings.push(`Empty filter array for "${filter.key}" — ignored`);
        continue;
      }
      searchParams.set(filter.urlKey, encodeJsonArray(filter.values));
    }
  }

  // Check for SN-only params passed via extra keys
  // (This is a type-level guard — the BasicSearchParams interface
  // doesn't include SN-only params, but callers may pass them via
  // a wider type.)
  for (const key of Object.keys(params)) {
    if (SN_ONLY_PARAMS.has(key)) {
      warnings.push(
        `"${key}" is a Sales Navigator filter — not applicable to basic search`,
      );
    }
  }

  const qs = searchParams.toString();
  const url = qs.length > 0 ? `${BASE_URL}?${qs}` : BASE_URL;

  return { url, sourceType: "SearchPage", warnings };
}
