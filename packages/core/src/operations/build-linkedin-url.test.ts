// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/source-type-registry.js", () => ({
  validateSourceType: vi.fn(),
}));

vi.mock("../services/url-builder.js", () => ({
  buildBasicSearchUrl: vi.fn(),
}));

vi.mock("../services/sn-url-builder.js", () => ({
  buildSNSearchUrl: vi.fn(),
}));

vi.mock("../services/url-templates.js", () => ({
  isSearchBuilderType: vi.fn(),
  isSNSearchBuilderType: vi.fn(),
  isParameterisedType: vi.fn(),
  isFixedUrlType: vi.fn(),
  buildParameterisedUrl: vi.fn(),
  getFixedUrl: vi.fn(),
}));

import { validateSourceType } from "../services/source-type-registry.js";
import { buildBasicSearchUrl } from "../services/url-builder.js";
import { buildSNSearchUrl } from "../services/sn-url-builder.js";
import {
  isSearchBuilderType,
  isSNSearchBuilderType,
  isParameterisedType,
  isFixedUrlType,
  buildParameterisedUrl,
  getFixedUrl,
} from "../services/url-templates.js";
import { buildLinkedInUrl } from "./build-linkedin-url.js";

describe("buildLinkedInUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all type checks return false
    vi.mocked(isSearchBuilderType).mockReturnValue(false);
    vi.mocked(isSNSearchBuilderType).mockReturnValue(false);
    vi.mocked(isParameterisedType).mockReturnValue(false);
    vi.mocked(isFixedUrlType).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on unknown source type", () => {
    vi.mocked(validateSourceType).mockReturnValue(false);

    expect(() =>
      buildLinkedInUrl({ sourceType: "UnknownType" }),
    ).toThrow('Unknown source type: "UnknownType"');
  });

  it("dispatches SearchPage to basic search builder", () => {
    vi.mocked(validateSourceType).mockReturnValue(true);
    vi.mocked(isSearchBuilderType).mockReturnValue(true);
    vi.mocked(buildBasicSearchUrl).mockReturnValue({
      url: "https://www.linkedin.com/search/results/people/?keywords=test",
      sourceType: "SearchPage",
      warnings: [],
    });

    const result = buildLinkedInUrl({
      sourceType: "SearchPage",
      keywords: "test",
    });

    expect(buildBasicSearchUrl).toHaveBeenCalledWith({ keywords: "test" });
    expect(result.url).toBe(
      "https://www.linkedin.com/search/results/people/?keywords=test",
    );
  });

  it("passes all search params to basic search builder", () => {
    vi.mocked(validateSourceType).mockReturnValue(true);
    vi.mocked(isSearchBuilderType).mockReturnValue(true);
    vi.mocked(buildBasicSearchUrl).mockReturnValue({
      url: "https://example.com",
      sourceType: "SearchPage",
      warnings: [],
    });

    buildLinkedInUrl({
      sourceType: "SearchPage",
      keywords: "engineer",
      currentCompany: ["1234"],
      pastCompany: ["5678"],
      geoUrn: ["101"],
      industry: ["96"],
      school: ["abc"],
      network: ["F"],
      profileLanguage: ["en"],
      serviceCategory: ["cat1"],
    });

    expect(buildBasicSearchUrl).toHaveBeenCalledWith({
      keywords: "engineer",
      currentCompany: ["1234"],
      pastCompany: ["5678"],
      geoUrn: ["101"],
      industry: ["96"],
      school: ["abc"],
      network: ["F"],
      profileLanguage: ["en"],
      serviceCategory: ["cat1"],
    });
  });

  it("omits undefined search params", () => {
    vi.mocked(validateSourceType).mockReturnValue(true);
    vi.mocked(isSearchBuilderType).mockReturnValue(true);
    vi.mocked(buildBasicSearchUrl).mockReturnValue({
      url: "https://example.com",
      sourceType: "SearchPage",
      warnings: [],
    });

    buildLinkedInUrl({ sourceType: "SearchPage" });

    expect(buildBasicSearchUrl).toHaveBeenCalledWith({});
  });

  it("dispatches SNSearchPage to SN search builder", () => {
    vi.mocked(validateSourceType).mockReturnValue(true);
    vi.mocked(isSNSearchBuilderType).mockReturnValue(true);
    vi.mocked(buildSNSearchUrl).mockReturnValue({
      url: "https://www.linkedin.com/sales/search/people?query=test",
      sourceType: "SNSearchPage",
      warnings: [],
    });

    const filters = [{ type: "COMPANY_SIZE", values: [{ id: "B", selectionType: "INCLUDED" as const }] }];

    const result = buildLinkedInUrl({
      sourceType: "SNSearchPage",
      keywords: "test",
      filters,
    });

    expect(buildSNSearchUrl).toHaveBeenCalledWith({
      keywords: "test",
      filters,
    });
    expect(result.sourceType).toBe("SNSearchPage");
  });

  it("dispatches parameterised type to template builder", () => {
    vi.mocked(validateSourceType).mockReturnValue(true);
    vi.mocked(isParameterisedType).mockReturnValue(true);
    vi.mocked(buildParameterisedUrl).mockReturnValue(
      "https://www.linkedin.com/company/acme/people/",
    );

    const result = buildLinkedInUrl({
      sourceType: "OrganizationPeople",
      slug: "acme",
    });

    expect(buildParameterisedUrl).toHaveBeenCalledWith(
      "OrganizationPeople",
      { slug: "acme" },
    );
    expect(result.url).toBe(
      "https://www.linkedin.com/company/acme/people/",
    );
    expect(result.warnings).toEqual([]);
  });

  it("throws when parameterised type returns undefined (missing param)", () => {
    vi.mocked(validateSourceType).mockReturnValue(true);
    vi.mocked(isParameterisedType).mockReturnValue(true);
    vi.mocked(buildParameterisedUrl).mockReturnValue(undefined);

    expect(() =>
      buildLinkedInUrl({ sourceType: "OrganizationPeople" }),
    ).toThrow("Missing required parameter");
  });

  it("dispatches fixed URL type", () => {
    vi.mocked(validateSourceType).mockReturnValue(true);
    vi.mocked(isFixedUrlType).mockReturnValue(true);
    vi.mocked(getFixedUrl).mockReturnValue(
      "https://www.linkedin.com/mynetwork/invite-connect/connections/",
    );

    const result = buildLinkedInUrl({ sourceType: "MyConnections" });

    expect(getFixedUrl).toHaveBeenCalledWith("MyConnections");
    expect(result.url).toBe(
      "https://www.linkedin.com/mynetwork/invite-connect/connections/",
    );
    expect(result.warnings).toEqual([]);
  });

  it("throws when fixed URL type returns undefined", () => {
    vi.mocked(validateSourceType).mockReturnValue(true);
    vi.mocked(isFixedUrlType).mockReturnValue(true);
    vi.mocked(getFixedUrl).mockReturnValue(undefined);

    expect(() =>
      buildLinkedInUrl({ sourceType: "MyConnections" }),
    ).toThrow("Missing fixed URL");
  });

  it("throws when no builder matches a validated source type", () => {
    vi.mocked(validateSourceType).mockReturnValue(true);

    expect(() =>
      buildLinkedInUrl({ sourceType: "SearchPage" }),
    ).toThrow("No URL builder available");
  });
});
