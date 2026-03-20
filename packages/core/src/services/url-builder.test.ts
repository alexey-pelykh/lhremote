// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { detectSourceType } from "./source-type-registry.js";
import { buildBasicSearchUrl } from "./url-builder.js";

describe("buildBasicSearchUrl", () => {
  it("builds base URL with no params", () => {
    const result = buildBasicSearchUrl({});
    expect(result.url).toBe(
      "https://www.linkedin.com/search/results/people/",
    );
    expect(result.sourceType).toBe("SearchPage");
    expect(result.warnings).toHaveLength(0);
  });

  it("includes keywords as query param", () => {
    const result = buildBasicSearchUrl({ keywords: "software engineer" });
    expect(result.url).toContain("keywords=software+engineer");
  });

  it("accepts boolean expression as keywords", () => {
    const result = buildBasicSearchUrl({
      keywords: { and: ["SaaS", "B2B"] },
    });
    expect(result.url).toContain("keywords=SaaS+AND+B2B");
  });

  it("accepts raw boolean expression as keywords", () => {
    const result = buildBasicSearchUrl({
      keywords: { raw: 'SaaS AND "VP"' },
    });
    expect(result.url).toContain("keywords=SaaS+AND+");
  });

  it("encodes currentCompany as JSON array", () => {
    const result = buildBasicSearchUrl({ currentCompany: ["1441"] });
    const url = new URL(result.url);
    expect(url.searchParams.get("currentCompany")).toBe('["1441"]');
  });

  it("encodes multiple geoUrn values", () => {
    const result = buildBasicSearchUrl({
      geoUrn: ["103644278", "102277331"],
    });
    const url = new URL(result.url);
    expect(url.searchParams.get("geoUrn")).toBe(
      '["103644278","102277331"]',
    );
  });

  it("encodes network filter", () => {
    const result = buildBasicSearchUrl({ network: ["F", "S"] });
    const url = new URL(result.url);
    expect(url.searchParams.get("network")).toBe('["F","S"]');
  });

  it("encodes profileLanguage filter", () => {
    const result = buildBasicSearchUrl({ profileLanguage: ["en"] });
    const url = new URL(result.url);
    expect(url.searchParams.get("profileLanguage")).toBe('["en"]');
  });

  it("encodes school as schoolFilter", () => {
    const result = buildBasicSearchUrl({ school: ["13596"] });
    const url = new URL(result.url);
    expect(url.searchParams.get("schoolFilter")).toBe('["13596"]');
  });

  it("warns on empty filter arrays", () => {
    const result = buildBasicSearchUrl({ currentCompany: [] });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Empty filter array");
  });

  it("combines multiple filters", () => {
    const result = buildBasicSearchUrl({
      keywords: "software engineer",
      currentCompany: ["1441"],
      geoUrn: ["103644278"],
    });
    const url = new URL(result.url);
    expect(url.searchParams.get("keywords")).toBe("software engineer");
    expect(url.searchParams.get("currentCompany")).toBe('["1441"]');
    expect(url.searchParams.get("geoUrn")).toBe('["103644278"]');
  });

  it("output URL is detected as SearchPage", () => {
    const result = buildBasicSearchUrl({
      keywords: "test",
    });
    expect(detectSourceType(result.url)).toBe("SearchPage");
  });
});
