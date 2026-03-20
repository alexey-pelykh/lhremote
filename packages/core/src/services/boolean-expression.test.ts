// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { buildBooleanExpression } from "./boolean-expression.js";

describe("buildBooleanExpression", () => {
  describe("raw mode", () => {
    it("passes raw string through unmodified", () => {
      expect(
        buildBooleanExpression({ raw: 'SaaS AND "VP of Engineering"' }),
      ).toBe('SaaS AND "VP of Engineering"');
    });

    it("passes empty raw string through", () => {
      expect(buildBooleanExpression({ raw: "" })).toBe("");
    });
  });

  describe("structured mode", () => {
    it("joins AND terms with AND operator", () => {
      expect(
        buildBooleanExpression({ and: ["SaaS", "B2B"] }),
      ).toBe("SaaS AND B2B");
    });

    it("groups OR terms in parentheses", () => {
      expect(
        buildBooleanExpression({ or: ["PM", "product manager"] }),
      ).toBe('(PM OR "product manager")');
    });

    it("does not add parentheses for single OR term", () => {
      expect(
        buildBooleanExpression({ or: ["PM"] }),
      ).toBe("PM");
    });

    it("prefixes NOT terms with NOT", () => {
      expect(
        buildBooleanExpression({ not: ["intern"] }),
      ).toBe(" NOT intern");
    });

    it("wraps phrases in double quotes", () => {
      expect(
        buildBooleanExpression({ phrases: ["VP of Engineering"] }),
      ).toBe('"VP of Engineering"');
    });

    it("combines all structured fields", () => {
      const result = buildBooleanExpression({
        phrases: ["VP of Engineering"],
        and: ["SaaS", "B2B"],
        or: ["PM", "product manager"],
        not: ["intern"],
      });
      expect(result).toBe(
        '"VP of Engineering" AND SaaS AND B2B AND (PM OR "product manager") NOT intern',
      );
    });

    it("auto-quotes multi-word terms in AND", () => {
      expect(
        buildBooleanExpression({ and: ["data science", "AI"] }),
      ).toBe('"data science" AND AI');
    });

    it("auto-quotes multi-word terms in OR", () => {
      expect(
        buildBooleanExpression({ or: ["machine learning", "AI"] }),
      ).toBe('("machine learning" OR AI)');
    });

    it("auto-quotes multi-word terms in NOT", () => {
      expect(
        buildBooleanExpression({ not: ["junior developer"] }),
      ).toBe(' NOT "junior developer"');
    });

    it("returns empty string for empty structured input", () => {
      expect(buildBooleanExpression({})).toBe("");
    });

    it("returns empty string for empty arrays", () => {
      expect(
        buildBooleanExpression({ and: [], or: [], not: [], phrases: [] }),
      ).toBe("");
    });

    it("handles multiple NOT terms", () => {
      expect(
        buildBooleanExpression({ and: ["engineer"], not: ["intern", "junior"] }),
      ).toBe("engineer NOT intern NOT junior");
    });

    it("handles multiple phrases", () => {
      expect(
        buildBooleanExpression({
          phrases: ["Chief Technology Officer", "VP Engineering"],
        }),
      ).toBe('"Chief Technology Officer" AND "VP Engineering"');
    });
  });
});
