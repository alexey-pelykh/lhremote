// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { detectSourceType } from "./source-type-registry.js";
import { buildSNSearchUrl } from "./sn-url-builder.js";

describe("buildSNSearchUrl", () => {
  it("builds base URL with default query structure", () => {
    const result = buildSNSearchUrl({});
    expect(result.url).toContain(
      "https://www.linkedin.com/sales/search/people?query=(",
    );
    expect(result.url).toContain("spellCorrectionEnabled:true");
    expect(result.url).toContain("recentSearchParam:(doLogHistory:true)");
    expect(result.sourceType).toBe("SNSearchPage");
    expect(result.warnings).toHaveLength(0);
  });

  it("includes keywords in query", () => {
    const result = buildSNSearchUrl({
      keywords: "software engineer",
    });
    expect(result.url).toContain("keywords:software%20engineer");
  });

  it("accepts boolean expression as keywords", () => {
    const result = buildSNSearchUrl({
      keywords: { and: ["SaaS", "B2B"] },
    });
    expect(result.url).toContain("keywords:SaaS%20AND%20B2B");
  });

  it("encodes CURRENT_COMPANY filter in Rest.li format", () => {
    const result = buildSNSearchUrl({
      filters: [
        {
          type: "CURRENT_COMPANY",
          values: [
            {
              id: "urn:li:organization:1441",
              text: "Google",
              selectionType: "INCLUDED",
            },
          ],
        },
      ],
    });
    expect(result.url).toContain("filters:List(");
    expect(result.url).toContain("type:CURRENT_COMPANY");
    expect(result.url).toContain("selectionType:INCLUDED");
    expect(result.url).toContain("text:Google");
  });

  it("encodes multiple filters", () => {
    const result = buildSNSearchUrl({
      filters: [
        {
          type: "CURRENT_COMPANY",
          values: [
            {
              id: "urn:li:organization:1441",
              text: "Google",
              selectionType: "INCLUDED",
            },
          ],
        },
        {
          type: "REGION",
          values: [
            {
              id: "102277331",
              text: "San Francisco",
              selectionType: "INCLUDED",
            },
          ],
        },
      ],
    });
    expect(result.url).toContain("type:CURRENT_COMPANY");
    expect(result.url).toContain("type:REGION");
  });

  it("encodes EXCLUDED selectionType", () => {
    const result = buildSNSearchUrl({
      filters: [
        {
          type: "CURRENT_TITLE",
          values: [
            {
              id: "intern",
              text: "Intern",
              selectionType: "EXCLUDED",
            },
          ],
        },
      ],
    });
    expect(result.url).toContain("selectionType:EXCLUDED");
  });

  it("warns on basic-search-only filter types", () => {
    const result = buildSNSearchUrl({
      filters: [
        {
          type: "serviceCategory",
          values: [{ id: "1", selectionType: "INCLUDED" }],
        },
      ],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("basic search filter");
  });

  it("warns on unknown filter types", () => {
    const result = buildSNSearchUrl({
      filters: [
        {
          type: "UNKNOWN_FILTER",
          values: [{ id: "1", selectionType: "INCLUDED" }],
        },
      ],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Unknown Sales Navigator filter");
  });

  it("warns on empty filter values", () => {
    const result = buildSNSearchUrl({
      filters: [{ type: "CURRENT_COMPANY", values: [] }],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Empty values");
  });

  it("output URL is detected as SNSearchPage", () => {
    const result = buildSNSearchUrl({
      keywords: "test",
    });
    expect(detectSourceType(result.url)).toBe("SNSearchPage");
  });
});
