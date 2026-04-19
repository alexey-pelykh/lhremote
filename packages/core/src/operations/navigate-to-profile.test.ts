// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { buildProfileUrl, extractPublicId, LINKEDIN_PROFILE_RE } from "./navigate-to-profile.js";

describe("LINKEDIN_PROFILE_RE", () => {
  it.each([
    ["https://www.linkedin.com/in/jane-doe/", "jane-doe"],
    ["https://www.linkedin.com/in/jane-doe", "jane-doe"],
    ["https://linkedin.com/in/jane-doe/", "jane-doe"],
    ["http://www.linkedin.com/in/slug-with-dashes-123/", "slug-with-dashes-123"],
    [
      "https://www.linkedin.com/in/jane-doe/?originalSubdomain=fr",
      "jane-doe",
    ],
    ["https://www.linkedin.com/in/jane-doe#about", "jane-doe"],
    ["https://www.linkedin.com/in/jane-doe/recent-activity/all/", "jane-doe"],
  ])("matches %s", (url, expected) => {
    const match = LINKEDIN_PROFILE_RE.exec(url);
    expect(match?.[1]).toBe(expected);
  });
});

describe("extractPublicId", () => {
  it("extracts the public ID from a standard profile URL", () => {
    expect(extractPublicId("https://www.linkedin.com/in/jane-doe/")).toBe("jane-doe");
  });

  it("URL-decodes percent-encoded slugs", () => {
    expect(extractPublicId("https://www.linkedin.com/in/jos%C3%A9/")).toBe("josé");
  });

  it("preserves case in the slug", () => {
    expect(extractPublicId("https://www.linkedin.com/in/JaneDoe/")).toBe("JaneDoe");
  });

  it("strips query and fragment", () => {
    expect(
      extractPublicId("https://www.linkedin.com/in/jane-doe/?foo=bar#baz"),
    ).toBe("jane-doe");
  });

  it.each([
    ["https://www.linkedin.com/company/acme/"],
    ["https://example.com/in/jane-doe/"],
    ["not-a-url"],
    [""],
  ])("throws on invalid URL %s", (url) => {
    expect(() => extractPublicId(url)).toThrow("Invalid LinkedIn profile URL");
  });
});

describe("buildProfileUrl", () => {
  it("builds the canonical profile URL", () => {
    expect(buildProfileUrl("jane-doe")).toBe(
      "https://www.linkedin.com/in/jane-doe/",
    );
  });

  it("URL-encodes non-ASCII slugs", () => {
    expect(buildProfileUrl("josé")).toBe(
      "https://www.linkedin.com/in/jos%C3%A9/",
    );
  });

  it("round-trips through extractPublicId", () => {
    const slug = "some-weird-slug-123";
    expect(extractPublicId(buildProfileUrl(slug))).toBe(slug);
  });
});
