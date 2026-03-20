// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import {
  getFunctionById,
  getIndustryById,
  getLinkedInReferenceData,
  getSeniorityById,
  isReferenceDataType,
} from "./linkedin-reference.js";

describe("getLinkedInReferenceData", () => {
  it("returns industries with correct structure", () => {
    const industries = getLinkedInReferenceData("INDUSTRY");
    expect(industries.length).toBeGreaterThanOrEqual(140);

    for (const entry of industries) {
      expect(entry).toHaveProperty("id");
      expect(entry).toHaveProperty("name");
      expect(typeof entry.id).toBe("number");
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it("returns seniority levels with correct structure", () => {
    const levels = getLinkedInReferenceData("SENIORITY");
    expect(levels).toHaveLength(10);

    for (const entry of levels) {
      expect(typeof entry.id).toBe("number");
      expect(typeof entry.name).toBe("string");
    }
  });

  it("returns functions with correct structure", () => {
    const functions = getLinkedInReferenceData("FUNCTION");
    expect(functions.length).toBeGreaterThanOrEqual(20);

    for (const entry of functions) {
      expect(typeof entry.id).toBe("number");
      expect(typeof entry.name).toBe("string");
    }
  });

  it("returns company sizes with correct structure", () => {
    const sizes = getLinkedInReferenceData("COMPANY_SIZE");
    expect(sizes.length).toBeGreaterThanOrEqual(8);

    for (const entry of sizes) {
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.label).toBe("string");
    }
  });

  it("returns connection degrees with correct structure", () => {
    const degrees = getLinkedInReferenceData("CONNECTION_DEGREE");
    expect(degrees).toHaveLength(3);

    const codes = degrees.map((d) => d.code);
    expect(codes).toContain("F");
    expect(codes).toContain("S");
    expect(codes).toContain("O");
  });

  it("returns profile languages with correct structure", () => {
    const languages = getLinkedInReferenceData("PROFILE_LANGUAGE");
    expect(languages.length).toBeGreaterThanOrEqual(20);

    for (const entry of languages) {
      expect(typeof entry.code).toBe("string");
      expect(typeof entry.name).toBe("string");
      expect(entry.code.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("includes known industry IDs", () => {
    const industries = getLinkedInReferenceData("INDUSTRY");
    const ids = new Set(industries.map((i) => i.id));

    // Spot-check well-known industries
    expect(ids.has(4)).toBe(true); // Computer Software
    expect(ids.has(6)).toBe(true); // Internet
    expect(ids.has(96)).toBe(true); // IT and Services
  });

  it("has no duplicate IDs in industries", () => {
    const industries = getLinkedInReferenceData("INDUSTRY");
    const ids = industries.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no duplicate IDs in seniority levels", () => {
    const levels = getLinkedInReferenceData("SENIORITY");
    const ids = levels.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no duplicate IDs in functions", () => {
    const functions = getLinkedInReferenceData("FUNCTION");
    const ids = functions.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("getIndustryById", () => {
  it("returns correct industry for known ID", () => {
    const industry = getIndustryById(4);
    expect(industry?.name).toBe("Computer Software");
  });

  it("returns undefined for unknown ID", () => {
    expect(getIndustryById(99999)).toBeUndefined();
  });
});

describe("getSeniorityById", () => {
  it("returns correct seniority for known ID", () => {
    const seniority = getSeniorityById(8);
    expect(seniority?.name).toBe("CXO");
  });

  it("returns undefined for unknown ID", () => {
    expect(getSeniorityById(99)).toBeUndefined();
  });
});

describe("getFunctionById", () => {
  it("returns correct function for known ID", () => {
    const fn = getFunctionById(8);
    expect(fn?.name).toBe("Engineering");
  });

  it("returns undefined for unknown ID", () => {
    expect(getFunctionById(99)).toBeUndefined();
  });
});

describe("isReferenceDataType", () => {
  it("returns true for valid types", () => {
    expect(isReferenceDataType("INDUSTRY")).toBe(true);
    expect(isReferenceDataType("SENIORITY")).toBe(true);
    expect(isReferenceDataType("FUNCTION")).toBe(true);
    expect(isReferenceDataType("COMPANY_SIZE")).toBe(true);
    expect(isReferenceDataType("CONNECTION_DEGREE")).toBe(true);
    expect(isReferenceDataType("PROFILE_LANGUAGE")).toBe(true);
  });

  it("returns false for invalid types", () => {
    expect(isReferenceDataType("UNKNOWN")).toBe(false);
    expect(isReferenceDataType("")).toBe(false);
    expect(isReferenceDataType("industry")).toBe(false);
  });
});
