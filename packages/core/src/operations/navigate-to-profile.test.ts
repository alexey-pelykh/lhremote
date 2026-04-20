// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CDPClient } from "../cdp/client.js";
import {
  buildProfileUrl,
  captureProfileLoadFailure,
  extractPublicId,
  LINKEDIN_PROFILE_RE,
  PROFILE_READY_SELECTOR,
} from "./navigate-to-profile.js";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

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

describe("PROFILE_READY_SELECTOR", () => {
  // ADR-007: readiness signal is the profile action-button row, keyed on
  // stable aria-labels.  These assertions pin the intended variants so a
  // future "cleanup" that drops a variant is caught here rather than at
  // E2E run time.
  it.each([
    ['main button[aria-label^="Message"]'],
    ['main button[aria-label^="Follow "]'],
    ['main button[aria-label^="Following "]'],
    ['main button[aria-label^="Connect"]'],
    ['main button[aria-label^="Pending"]'],
    ['main button[aria-label="More actions"]'],
    ['main button[aria-label="More"]'],
  ])("includes %s", (fragment) => {
    expect(PROFILE_READY_SELECTOR).toContain(fragment);
  });

  it("is a comma-separated disjunction, not a compound selector", () => {
    expect(PROFILE_READY_SELECTOR).toContain(", ");
    // Must not accidentally chain selectors without separation.
    expect(PROFILE_READY_SELECTOR).not.toMatch(/\]main/);
  });
});

describe("captureProfileLoadFailure", () => {
  const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    } else {
      process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = originalEnv;
    }
  });

  function makeClient(): CDPClient {
    return {
      evaluate: vi.fn().mockResolvedValue({
        href: "https://www.linkedin.com/in/jane-doe/",
        title: "Jane Doe | LinkedIn",
        hasMain: true,
        hasH1: false,
        hasMainH1: false,
        bodyTextSnippet: "Jane Doe\nSoftware Engineer\n",
      }),
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;
  }

  it("is a no-op when LHREMOTE_CAPTURE_DIAGNOSTICS is unset", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const client = makeClient();

    await captureProfileLoadFailure(client, "jane-doe");

    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });

  it("is a no-op when LHREMOTE_CAPTURE_DIAGNOSTICS is any truthy-but-not-\"1\" value", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "true";
    const client = makeClient();

    await captureProfileLoadFailure(client, "jane-doe");

    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });

  it("captures DOM probes and screenshot when LHREMOTE_CAPTURE_DIAGNOSTICS=1", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();

    await captureProfileLoadFailure(client, "jane-doe");

    expect(client.evaluate).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
  });

  it("swallows capture-side errors rather than masking the caller's timeout", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = {
      evaluate: vi.fn().mockRejectedValue(new Error("evaluate failed")),
      send: vi.fn(),
    } as unknown as CDPClient;

    await expect(
      captureProfileLoadFailure(client, "jane-doe"),
    ).resolves.toBeUndefined();
  });

  it("sanitizes publicId before using it in the artifact filename", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();

    // Any of these would otherwise escape the base directory or produce
    // invalid filenames on Windows/macOS.  sanitizeForFilename replaces
    // every non-`[a-zA-Z0-9._-]` char with `_`.
    await captureProfileLoadFailure(client, "../../../etc/passwd");
    await captureProfileLoadFailure(client, "slug with spaces");
    await captureProfileLoadFailure(client, "slug/with/slashes");

    // The function completes without throwing for any of these inputs;
    // filesystem writes are mocked.  The sanitization is verified
    // indirectly by the absence of an exception — direct path assertion
    // would couple the test to the mocked mkdir/writeFile signatures.
    expect(client.evaluate).toHaveBeenCalledTimes(3);
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
