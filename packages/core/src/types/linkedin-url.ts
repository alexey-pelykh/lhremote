// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Types of LinkedIn reference data available for URL building.
 */
export type ReferenceDataType =
  | "INDUSTRY"
  | "SENIORITY"
  | "FUNCTION"
  | "COMPANY_SIZE"
  | "CONNECTION_DEGREE"
  | "PROFILE_LANGUAGE";

/** LinkedIn industry entry from the Marketing API taxonomy. */
export interface IndustryEntry {
  readonly id: number;
  readonly name: string;
}

/** LinkedIn seniority level. */
export interface SeniorityEntry {
  readonly id: number;
  readonly name: string;
}

/** LinkedIn job function / department. */
export interface FunctionEntry {
  readonly id: number;
  readonly name: string;
}

/** LinkedIn company size range. */
export interface CompanySizeEntry {
  readonly id: string;
  readonly label: string;
}

/** LinkedIn connection degree. */
export interface ConnectionDegreeEntry {
  readonly code: "F" | "S" | "O";
  readonly label: string;
}

/** LinkedIn profile language (ISO 639-1 subset). */
export interface ProfileLanguageEntry {
  readonly code: string;
  readonly name: string;
}

/**
 * Input for building a LinkedIn boolean keyword expression.
 *
 * Either a structured object with AND/OR/NOT/phrases arrays,
 * or a raw passthrough string.
 */
export type BooleanExpressionInput =
  | BooleanExpressionStructured
  | BooleanExpressionRaw;

/** Structured boolean expression with combinable term arrays. */
export interface BooleanExpressionStructured {
  readonly and?: string[] | undefined;
  readonly or?: string[] | undefined;
  readonly not?: string[] | undefined;
  readonly phrases?: string[] | undefined;
}

/** Raw boolean expression passed through as-is. */
export interface BooleanExpressionRaw {
  readonly raw: string;
}

/**
 * Parameters for building a LinkedIn basic search URL.
 */
export interface BasicSearchParams {
  readonly keywords?: string | BooleanExpressionInput | undefined;
  readonly currentCompany?: string[] | undefined;
  readonly pastCompany?: string[] | undefined;
  readonly geoUrn?: string[] | undefined;
  readonly industry?: string[] | undefined;
  readonly school?: string[] | undefined;
  readonly network?: string[] | undefined;
  readonly profileLanguage?: string[] | undefined;
  readonly serviceCategory?: string[] | undefined;
}

/**
 * A single filter value for Sales Navigator search.
 */
export interface SNFilterValue {
  readonly id: string;
  readonly text?: string | undefined;
  readonly selectionType: "INCLUDED" | "EXCLUDED";
}

/**
 * A filter for Sales Navigator search (type + values).
 */
export interface SNFilter {
  readonly type: string;
  readonly values: SNFilterValue[];
}

/**
 * Parameters for building a Sales Navigator search URL.
 */
export interface SNSearchParams {
  readonly keywords?: string | BooleanExpressionInput | undefined;
  readonly filters?: SNFilter[] | undefined;
}

/**
 * Result from a URL builder: the URL plus any warnings.
 */
export interface UrlBuilderResult {
  readonly url: string;
  readonly sourceType: string;
  readonly warnings: string[];
}

/**
 * A resolved LinkedIn entity from typeahead lookup.
 */
export interface EntityMatch {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

/**
 * Entity types supported by the typeahead resolver.
 */
export type EntityType = "COMPANY" | "GEO" | "SCHOOL";
