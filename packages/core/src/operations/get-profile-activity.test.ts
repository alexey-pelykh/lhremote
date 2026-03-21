// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { extractProfileId } from "./get-profile-activity.js";

describe("extractProfileId", () => {
  it("extracts public ID from full profile URL", () => {
    expect(
      extractProfileId("https://www.linkedin.com/in/johndoe"),
    ).toBe("johndoe");
  });

  it("extracts public ID from profile URL with trailing slash", () => {
    expect(
      extractProfileId("https://www.linkedin.com/in/johndoe/"),
    ).toBe("johndoe");
  });

  it("extracts public ID from profile URL with query params", () => {
    expect(
      extractProfileId(
        "https://www.linkedin.com/in/johndoe?miniProfileUrn=urn",
      ),
    ).toBe("johndoe");
  });

  it("extracts public ID from profile URL with hash", () => {
    expect(
      extractProfileId("https://www.linkedin.com/in/johndoe#section"),
    ).toBe("johndoe");
  });

  it("decodes URL-encoded public ID", () => {
    expect(
      extractProfileId("https://www.linkedin.com/in/john%20doe"),
    ).toBe("john doe");
  });

  it("passes through bare public ID", () => {
    expect(extractProfileId("johndoe")).toBe("johndoe");
  });

  it("passes through bare public ID with hyphens", () => {
    expect(extractProfileId("john-doe-123")).toBe("john-doe-123");
  });

  it("throws on unrecognised URL", () => {
    expect(() => extractProfileId("https://example.com/foo")).toThrow(
      "Cannot extract profile ID from",
    );
  });

  it("throws on empty input", () => {
    expect(() => extractProfileId("")).toThrow(
      "Cannot extract profile ID from",
    );
  });
});
