// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { SourceType } from "../types/collection.js";
import type {
  BasicSearchParams,
  SNSearchParams,
  UrlBuilderResult,
} from "../types/linkedin-url.js";
import { validateSourceType } from "../services/source-type-registry.js";
import { buildBasicSearchUrl } from "../services/url-builder.js";
import { buildSNSearchUrl } from "../services/sn-url-builder.js";
import {
  buildParameterisedUrl,
  getFixedUrl,
  isFixedUrlType,
  isParameterisedType,
  isSNSearchBuilderType,
  isSearchBuilderType,
} from "../services/url-templates.js";

/**
 * Input for the unified LinkedIn URL builder.
 */
export interface BuildLinkedInUrlInput {
  /** The LinkedIn source type to build a URL for. */
  readonly sourceType: string;

  // SearchPage params
  readonly keywords?: BasicSearchParams["keywords"] | undefined;
  readonly currentCompany?: string[] | undefined;
  readonly pastCompany?: string[] | undefined;
  readonly geoUrn?: string[] | undefined;
  readonly industry?: string[] | undefined;
  readonly school?: string[] | undefined;
  readonly network?: string[] | undefined;
  readonly profileLanguage?: string[] | undefined;
  readonly serviceCategory?: string[] | undefined;

  // SNSearchPage params
  readonly filters?: SNSearchParams["filters"] | undefined;

  // Parameterised template params
  readonly slug?: string | undefined;
  readonly id?: string | undefined;
}

/**
 * Output from the unified URL builder.
 */
export type BuildLinkedInUrlOutput = UrlBuilderResult;

/**
 * Build a LinkedIn URL for any supported source type.
 *
 * Dispatches to the appropriate builder based on the source type:
 * - `SearchPage` → basic search URL builder
 * - `SNSearchPage` → Sales Navigator URL builder
 * - Parameterised types → template substitution
 * - Fixed types → static URL lookup
 *
 * @param input - Build parameters including source type
 * @returns The built URL with any warnings
 * @throws Error if the source type is unknown or required params are missing
 */
export function buildLinkedInUrl(
  input: BuildLinkedInUrlInput,
): BuildLinkedInUrlOutput {
  if (!validateSourceType(input.sourceType)) {
    throw new Error(`Unknown source type: "${input.sourceType}"`);
  }

  const sourceType = input.sourceType as SourceType;

  // SearchPage → basic search builder
  if (isSearchBuilderType(sourceType)) {
    const params: BasicSearchParams = {
      ...(input.keywords !== undefined && { keywords: input.keywords }),
      ...(input.currentCompany !== undefined && { currentCompany: input.currentCompany }),
      ...(input.pastCompany !== undefined && { pastCompany: input.pastCompany }),
      ...(input.geoUrn !== undefined && { geoUrn: input.geoUrn }),
      ...(input.industry !== undefined && { industry: input.industry }),
      ...(input.school !== undefined && { school: input.school }),
      ...(input.network !== undefined && { network: input.network }),
      ...(input.profileLanguage !== undefined && { profileLanguage: input.profileLanguage }),
      ...(input.serviceCategory !== undefined && { serviceCategory: input.serviceCategory }),
    };
    return buildBasicSearchUrl(params);
  }

  // SNSearchPage → SN search builder
  if (isSNSearchBuilderType(sourceType)) {
    const params: SNSearchParams = {
      ...(input.keywords !== undefined && { keywords: input.keywords }),
      ...(input.filters !== undefined && { filters: input.filters }),
    };
    return buildSNSearchUrl(params);
  }

  // Parameterised template types
  if (isParameterisedType(sourceType)) {
    const url = buildParameterisedUrl(sourceType, {
      ...(input.slug !== undefined && { slug: input.slug }),
      ...(input.id !== undefined && { id: input.id }),
    });
    if (url === undefined) {
      throw new Error(
        `Missing required parameter for source type "${sourceType}": ` +
          "provide slug or id as appropriate",
      );
    }
    return { url, sourceType, warnings: [] };
  }

  // Fixed URL types
  if (isFixedUrlType(sourceType)) {
    const url = getFixedUrl(sourceType) ?? "";
    return { url, sourceType, warnings: [] };
  }

  // Should not reach here if validateSourceType passed,
  // but handle gracefully
  throw new Error(
    `No URL builder available for source type "${sourceType}"`,
  );
}
