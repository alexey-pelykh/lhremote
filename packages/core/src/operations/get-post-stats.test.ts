// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { extractPostUrn } from "./get-post-stats.js";

describe("extractPostUrn", () => {
  it("extracts URN from /feed/update/ URL with activity URN", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      ),
    ).toBe("urn:li:activity:7123456789012345678");
  });

  it("extracts URN from /feed/update/ URL with ugcPost URN", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:ugcPost:7123456789012345678/",
      ),
    ).toBe("urn:li:ugcPost:7123456789012345678");
  });

  it("extracts URN from /feed/update/ URL with share URN", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678/",
      ),
    ).toBe("urn:li:share:7123456789012345678");
  });

  it("extracts URN from /feed/update/ URL without trailing slash", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678",
      ),
    ).toBe("urn:li:activity:7123456789012345678");
  });

  it("extracts activity URN from /posts/ URL", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/posts/johndoe_activity-7123456789012345678-abcd/",
      ),
    ).toBe("urn:li:activity:7123456789012345678");
  });

  it("passes through raw URN input", () => {
    expect(extractPostUrn("urn:li:activity:7123456789012345678")).toBe(
      "urn:li:activity:7123456789012345678",
    );
  });

  it("passes through raw ugcPost URN", () => {
    expect(extractPostUrn("urn:li:ugcPost:7123456789012345678")).toBe(
      "urn:li:ugcPost:7123456789012345678",
    );
  });

  it("throws on unrecognised input", () => {
    expect(() => extractPostUrn("https://example.com/foo")).toThrow(
      "Cannot extract post URN from",
    );
  });

  it("throws on empty input", () => {
    expect(() => extractPostUrn("")).toThrow("Cannot extract post URN from");
  });
});
