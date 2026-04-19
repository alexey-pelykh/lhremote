// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { buildProfileUrl, extractPublicId, LINKEDIN_PROFILE_RE } from "./navigate-to-profile.js";

describe("LINKEDIN_PROFILE_RE", () => {
  it.each([
    ["/in/jane-doe/", "jane-doe"],
    ["/in/jane-doe", "jane-doe"],
    ["/in/slug-with-dashes-123/", "slug-with-dashes-123"],
    ["/in/jane-doe/recent-activity/all/", "jane-doe"],
  ])("matches pathname %s", (pathname, expected) => {
    const match = LINKEDIN_PROFILE_RE.exec(pathname);
    expect(match?.[1]).toBe(expected);
  });

  it.each([
    ["/company/acme/"],
    ["/foo/bar"],
    ["in/jane-doe/"], // no leading slash
  ])("does NOT match pathname %s", (pathname) => {
    expect(LINKEDIN_PROFILE_RE.exec(pathname)).toBeNull();
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

  it("accepts locale subdomains (e.g. fr.linkedin.com)", () => {
    expect(extractPublicId("https://fr.linkedin.com/in/jane-doe/")).toBe("jane-doe");
  });

  it("accepts linkedin.com without www", () => {
    expect(extractPublicId("https://linkedin.com/in/jane-doe")).toBe("jane-doe");
  });

  it("accepts http scheme", () => {
    expect(extractPublicId("http://www.linkedin.com/in/jane-doe/")).toBe("jane-doe");
  });

  it.each([
    // Non-profile LinkedIn paths
    ["https://www.linkedin.com/company/acme/"],
    ["https://www.linkedin.com/feed/"],
    // Non-LinkedIn hosts
    ["https://example.com/in/jane-doe/"],
    ["https://notlinkedin.com/in/jane-doe/"],
    ["https://linkedin.com.evil.com/in/jane-doe/"],
    // Embedded profile link in query/fragment of a non-LinkedIn URL — must NOT match
    ["https://example.com/?next=https://www.linkedin.com/in/jane-doe/"],
    ["https://example.com/#https://www.linkedin.com/in/jane-doe/"],
    // Malformed / unparseable
    ["not-a-url"],
    [""],
    ["/in/jane-doe/"], // no scheme
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
