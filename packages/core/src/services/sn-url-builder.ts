// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type {
  BooleanExpressionInput,
  SNFilter,
  SNSearchParams,
  UrlBuilderResult,
} from "../types/linkedin-url.js";
import { buildBooleanExpression } from "./boolean-expression.js";

const BASE_URL = "https://www.linkedin.com/sales/search/people";

/**
 * Valid Sales Navigator filter types.
 */
const VALID_SN_FILTER_TYPES: ReadonlySet<string> = new Set([
  "CURRENT_COMPANY",
  "PAST_COMPANY",
  "REGION",
  "SENIORITY_LEVEL",
  "FUNCTION",
  "INDUSTRY",
  "COMPANY_HEADCOUNT",
  "COMPANY_TYPE",
  "CURRENT_TITLE",
  "PAST_TITLE",
  "YEARS_AT_CURRENT_COMPANY",
  "YEARS_AT_CURRENT_POSITION",
  "YEARS_OF_EXPERIENCE",
  "SCHOOL",
  "PROFILE_LANGUAGE",
  "GROUP",
  "CONNECTION",
]);

/**
 * Filter types only valid for basic search, not Sales Navigator.
 */
const BASIC_SEARCH_ONLY_FILTER_TYPES: ReadonlySet<string> = new Set([
  "serviceCategory",
]);

/**
 * Resolve keywords to a string.
 */
function resolveKeywords(
  keywords: string | BooleanExpressionInput,
): string {
  if (typeof keywords === "string") return keywords;
  return buildBooleanExpression(keywords);
}

/**
 * Encode a single filter value in Rest.li format.
 *
 * Output: `(id:value,text:value,selectionType:INCLUDED)`
 */
function encodeFilterValue(value: {
  id: string;
  text?: string | undefined;
  selectionType: string;
}): string {
  const parts: string[] = [
    `id:${encodeRestLiValue(value.id)}`,
  ];
  if (value.text !== undefined) {
    parts.push(`text:${encodeRestLiValue(value.text)}`);
  }
  parts.push(`selectionType:${value.selectionType}`);
  return `(${parts.join(",")})`;
}

/**
 * Encode a filter in Rest.li format.
 *
 * Output: `(type:CURRENT_COMPANY,values:List((id:...,selectionType:INCLUDED)))`
 */
function encodeFilter(filter: SNFilter): string {
  const values = filter.values.map(encodeFilterValue).join(",");
  return `(type:${filter.type},values:List(${values}))`;
}

/**
 * Percent-encode a value for Rest.li URI format.
 *
 * Rest.li uses standard percent-encoding but keeps the parentheses/commas
 * structural (they are part of the Rest.li syntax, not data).
 */
function encodeRestLiValue(value: string): string {
  return encodeURIComponent(value)
    .replace(/%3A/gi, ":")
    .replace(/%2C/gi, ",");
}

/**
 * Build a Sales Navigator search (`/sales/search/people`) URL
 * with Rest.li protocol encoding.
 *
 * @param params - SN search parameters
 * @returns URL and any warnings
 *
 * @example
 * ```ts
 * buildSNSearchUrl({
 *   keywords: "software engineer",
 *   filters: [{
 *     type: "CURRENT_COMPANY",
 *     values: [{ id: "urn:li:organization:1441", text: "Google", selectionType: "INCLUDED" }],
 *   }],
 * });
 * ```
 */
export function buildSNSearchUrl(
  params: SNSearchParams,
): UrlBuilderResult {
  const warnings: string[] = [];
  const queryParts: string[] = [];

  queryParts.push("spellCorrectionEnabled:true");
  queryParts.push("recentSearchParam:(doLogHistory:true)");

  // Filters
  if (params.filters !== undefined && params.filters.length > 0) {
    const validFilters: SNFilter[] = [];

    for (const filter of params.filters) {
      if (BASIC_SEARCH_ONLY_FILTER_TYPES.has(filter.type)) {
        warnings.push(
          `"${filter.type}" is a basic search filter — not applicable to Sales Navigator`,
        );
        continue;
      }
      if (!VALID_SN_FILTER_TYPES.has(filter.type)) {
        warnings.push(`Unknown Sales Navigator filter type: "${filter.type}"`);
        continue;
      }
      if (filter.values.length === 0) {
        warnings.push(`Empty values for filter "${filter.type}" — ignored`);
        continue;
      }
      validFilters.push(filter);
    }

    if (validFilters.length > 0) {
      const filtersList = validFilters.map(encodeFilter).join(",");
      queryParts.push(`filters:List(${filtersList})`);
    }
  }

  // Keywords
  if (params.keywords !== undefined) {
    const keywordsStr = resolveKeywords(params.keywords);
    if (keywordsStr.length > 0) {
      queryParts.push(`keywords:${encodeRestLiValue(keywordsStr)}`);
    }
  }

  const query = `(${queryParts.join(",")})`;
  const url = `${BASE_URL}?query=${query}`;

  return { url, sourceType: "SNSearchPage", warnings };
}
