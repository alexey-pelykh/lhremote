// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type {
  BooleanExpressionInput,
  BooleanExpressionRaw,
} from "../types/linkedin-url.js";

/**
 * Check whether the input is a raw boolean expression passthrough.
 */
function isRawExpression(
  input: BooleanExpressionInput,
): input is BooleanExpressionRaw {
  return "raw" in input;
}

/**
 * Quote a term if it contains spaces.
 */
function quoteTerm(term: string): string {
  return term.includes(" ") ? `"${term}"` : term;
}

/**
 * Build a LinkedIn boolean keyword expression from structured input
 * or pass through a raw string.
 *
 * LinkedIn supports AND/OR/NOT operators (must be UPPERCASE),
 * quoted phrases, and parenthetical grouping.
 *
 * @param input - Structured boolean input or raw passthrough
 * @returns The composed boolean expression string
 *
 * @example
 * ```ts
 * // Structured mode
 * buildBooleanExpression({
 *   phrases: ["VP of Engineering"],
 *   and: ["SaaS", "B2B"],
 *   or: ["PM", "product manager"],
 *   not: ["intern"],
 * });
 * // → '"VP of Engineering" AND SaaS AND B2B AND (PM OR "product manager") NOT intern'
 *
 * // Raw mode
 * buildBooleanExpression({ raw: 'SaaS AND "VP of Engineering"' });
 * // → 'SaaS AND "VP of Engineering"'
 * ```
 */
export function buildBooleanExpression(input: BooleanExpressionInput): string {
  if (isRawExpression(input)) {
    return input.raw;
  }

  const parts: string[] = [];

  // Quoted phrases
  if (input.phrases !== undefined && input.phrases.length > 0) {
    for (const phrase of input.phrases) {
      parts.push(`"${phrase}"`);
    }
  }

  // AND terms
  if (input.and !== undefined && input.and.length > 0) {
    for (const term of input.and) {
      parts.push(quoteTerm(term));
    }
  }

  // OR group (parenthesised when multiple values)
  if (input.or !== undefined && input.or.length > 0) {
    const orTerms = input.or.map(quoteTerm);
    if (orTerms.length === 1) {
      parts.push(orTerms[0] ?? "");
    } else {
      parts.push(`(${orTerms.join(" OR ")})`);
    }
  }

  // Build the positive expression with AND between all parts
  let expression = parts.join(" AND ");

  // NOT terms appended at the end
  if (input.not !== undefined && input.not.length > 0) {
    for (const term of input.not) {
      expression += ` NOT ${quoteTerm(term)}`;
    }
  }

  return expression;
}
