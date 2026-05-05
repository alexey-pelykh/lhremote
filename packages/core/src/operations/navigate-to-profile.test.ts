// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CDPClient } from "../cdp/client.js";

// Register the fs-promises mock BEFORE importing the module under test.
// `navigate-to-profile.ts` imports `node:fs/promises` at module load;
// relying on Vitest's vi.mock hoisting to cover this is brittle under
// ESM transforms.  Dynamic-import after the mock guarantees the mocked
// version is the one the module sees.
vi.mock("node:fs/promises", () => ({
  // mkdtemp returns the path of the freshly-created directory; we
  // append a deterministic suffix in tests so assertions can match it.
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}TESTABCDEF`),
  writeFile: vi.fn().mockResolvedValue(undefined),
  // lstat/chmod back the post-mkdtemp security check
  // (`ensureSecureDiagnosticDir`).  Default returns a fresh-and-secure
  // directory shape so tests that don't care about the security path
  // continue to pass.
  lstat: vi.fn().mockResolvedValue({
    isSymbolicLink: () => false,
    isDirectory: () => true,
    mode: 0o700,
  }),
  chmod: vi.fn().mockResolvedValue(undefined),
}));

const {
  buildCompanyUrl,
  buildProfileUrl,
  captureCompanyLoadFailure,
  captureProfileLoadFailure,
  extractFollowableTarget,
  extractPublicId,
  LINKEDIN_COMPANY_RE,
  LINKEDIN_PROFILE_RE,
  PROFILE_READY_SELECTOR,
} = await import("./navigate-to-profile.js");

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

describe("LINKEDIN_COMPANY_RE", () => {
  it.each([
    ["/company/acme/", "acme"],
    ["/company/acme", "acme"],
    ["/company/mirohq/", "mirohq"],
    ["/company/slug-with-dashes-123/", "slug-with-dashes-123"],
    ["/company/acme/about/", "acme"],
    ["/company/acme/people/", "acme"],
  ])("matches pathname %s", (pathname, expected) => {
    const match = LINKEDIN_COMPANY_RE.exec(pathname);
    expect(match?.[1]).toBe(expected);
  });

  it.each([
    ["/in/jane-doe/"],
    ["/foo/bar"],
    ["company/acme/"], // no leading slash
  ])("does NOT match pathname %s", (pathname) => {
    expect(LINKEDIN_COMPANY_RE.exec(pathname)).toBeNull();
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
    // Non-profile LinkedIn paths — extractPublicId is profile-only;
    // extractFollowableTarget covers /company/.
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

  it("converts URIError from malformed percent-encoding into the validation error", () => {
    // `%ZZ` is syntactically a percent-escape but invalid hex; native
    // `decodeURIComponent` throws `URIError`.  The function must catch
    // and re-throw the standard validation error so callers see one
    // uniform error class and message.
    expect(() => extractPublicId("https://www.linkedin.com/in/foo%ZZ/")).toThrow(
      "Invalid LinkedIn profile URL",
    );
  });
});

describe("extractFollowableTarget", () => {
  it("returns a profile target for /in/{publicId}/ URLs", () => {
    expect(extractFollowableTarget("https://www.linkedin.com/in/jane-doe/")).toEqual({
      kind: "profile",
      publicId: "jane-doe",
    });
  });

  it("returns a company target for /company/{slug}/ URLs", () => {
    expect(
      extractFollowableTarget("https://www.linkedin.com/company/mirohq/"),
    ).toEqual({
      kind: "company",
      slug: "mirohq",
    });
  });

  it("returns a company target without a trailing slash", () => {
    expect(
      extractFollowableTarget("https://www.linkedin.com/company/acme"),
    ).toEqual({
      kind: "company",
      slug: "acme",
    });
  });

  it("captures only the slug segment from /company/{slug}/about/", () => {
    expect(
      extractFollowableTarget("https://www.linkedin.com/company/acme/about/"),
    ).toEqual({
      kind: "company",
      slug: "acme",
    });
  });

  it("URL-decodes percent-encoded company slugs", () => {
    expect(
      extractFollowableTarget("https://www.linkedin.com/company/jos%C3%A9-corp/"),
    ).toEqual({
      kind: "company",
      slug: "josé-corp",
    });
  });

  it("strips query and fragment for company URLs", () => {
    expect(
      extractFollowableTarget(
        "https://www.linkedin.com/company/acme/?foo=bar#baz",
      ),
    ).toEqual({
      kind: "company",
      slug: "acme",
    });
  });

  it("accepts locale subdomains for company URLs", () => {
    expect(
      extractFollowableTarget("https://fr.linkedin.com/company/acme/"),
    ).toEqual({
      kind: "company",
      slug: "acme",
    });
  });

  it("accepts http scheme for company URLs", () => {
    expect(
      extractFollowableTarget("http://www.linkedin.com/company/acme/"),
    ).toEqual({
      kind: "company",
      slug: "acme",
    });
  });

  it("accepts linkedin.com without www for company URLs", () => {
    expect(
      extractFollowableTarget("https://linkedin.com/company/acme"),
    ).toEqual({
      kind: "company",
      slug: "acme",
    });
  });

  it.each([
    // Non-followable LinkedIn paths
    ["https://www.linkedin.com/feed/"],
    ["https://www.linkedin.com/groups/123/"],
    ["https://www.linkedin.com/school/mit/"],
    // Non-LinkedIn hosts
    ["https://example.com/in/jane-doe/"],
    ["https://example.com/company/acme/"],
    ["https://notlinkedin.com/company/acme/"],
    ["https://linkedin.com.evil.com/company/acme/"],
    // Embedded link in a non-LinkedIn URL — must NOT match
    ["https://example.com/?next=https://www.linkedin.com/company/acme/"],
    ["https://example.com/#https://www.linkedin.com/company/acme/"],
    // Malformed / unparseable
    ["not-a-url"],
    [""],
    ["/company/acme/"], // no scheme
  ])("throws on invalid URL %s", (url) => {
    expect(() => extractFollowableTarget(url)).toThrow(
      "Invalid LinkedIn profile or company URL",
    );
  });

  it.each([
    // `%ZZ` is syntactically a percent-escape but invalid hex; native
    // `decodeURIComponent` throws `URIError`.  Both the profile and the
    // company branch must catch and re-throw the standard validation
    // error so callers see one uniform error class and message.
    ["https://www.linkedin.com/in/foo%ZZ/"],
    ["https://www.linkedin.com/company/acme%ZZ/"],
  ])(
    "converts URIError from malformed percent-encoding into the validation error: %s",
    (url) => {
      expect(() => extractFollowableTarget(url)).toThrow(
        "Invalid LinkedIn profile or company URL",
      );
    },
  );
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

  it("late rejection from capture body does not surface as UnhandledPromiseRejection (timer-wins race)", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";

    // Mirrors the same test in wait-for-post-load.test.ts — exercises
    // the `.catch(() => undefined)` on the inner Promise.race arm.
    // Without that catch, when the timer wins the race AND the inner
    // capture rejects later, the rejection escapes as an
    // UnhandledPromiseRejection.  This test forces that scenario:
    // setTimeout fires synchronously on the microtask queue (timer
    // always wins), and the inner evaluate's setImmediate-scheduled
    // rejection then has nowhere to land.
    const unhandled: unknown[] = [];
    const handler = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", handler);

    const timeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((cb: () => void) => {
        Promise.resolve().then(cb);
        return 0 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout);

    try {
      const client = {
        evaluate: vi.fn(
          () =>
            new Promise<unknown>((_, reject) => {
              setImmediate(() =>
                reject(new Error("simulated late CDP rejection")),
              );
            }),
        ),
        send: vi.fn(),
      } as unknown as CDPClient;

      await captureProfileLoadFailure(client, "jane-doe");

      // Allow the late rejection to settle.
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setImmediate(r));

      expect(unhandled).toHaveLength(0);
    } finally {
      timeoutSpy.mockRestore();
      process.off("unhandledRejection", handler);
    }
  });

  it("sanitizes publicId so path separators in the decoded slug can't escape the diagnostics dir", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();
    const { writeFile } = await import("node:fs/promises");
    const writeFileMock = vi.mocked(writeFile);
    writeFileMock.mockClear();

    // `extractPublicId` URL-decodes before returning, so `%2F`, `%5C`,
    // and traversal fragments can reach this code.  Sanitization must
    // replace any path separator in the slug so the final path stays
    // a direct child of `${tmpdir()}/lhremote-diagnostics/`.
    await captureProfileLoadFailure(client, "../../../etc/passwd");
    await captureProfileLoadFailure(client, "slug\\with\\backslashes");
    await captureProfileLoadFailure(client, "slug/with/slashes");
    await captureProfileLoadFailure(client, "slug with spaces");

    // Each capture writes a .json (and attempts a .png) — at minimum
    // the .json calls must have been made for all four inputs.
    expect(writeFileMock.mock.calls.length).toBeGreaterThanOrEqual(4);

    for (const call of writeFileMock.mock.calls) {
      const filePath = String(call[0]);
      const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
      const baseDir = lastSep >= 0 ? filePath.slice(0, lastSep) : "";
      const filename = lastSep >= 0 ? filePath.slice(lastSep + 1) : filePath;

      // The basename must contain no path separator — otherwise the
      // file would escape baseDir when joined.
      expect(filename).not.toMatch(/[/\\]/);
      // The basename must follow the expected shape: the
      // navigate-to-profile prefix + timestamp + sanitized slug +
      // extension.  No stray `..` segments that are separated from
      // other chars by `/` — we already asserted no `/` — so the
      // filename as a whole stays in-directory.
      expect(filename).toMatch(
        /^navigate-to-profile-[\w.-]+\.(json|png)$/,
      );
      // And the parent directory ends at the per-invocation mkdtemp
      // result — see capturePostLoadFailure for the TOCTOU rationale.
      expect(baseDir).toMatch(/lhremote-diagnostics-[A-Za-z0-9]+$/);
    }
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

describe("buildCompanyUrl", () => {
  it("builds the canonical company URL", () => {
    expect(buildCompanyUrl("mirohq")).toBe(
      "https://www.linkedin.com/company/mirohq/",
    );
  });

  it("URL-encodes non-ASCII slugs", () => {
    expect(buildCompanyUrl("josé-corp")).toBe(
      "https://www.linkedin.com/company/jos%C3%A9-corp/",
    );
  });

  it("round-trips through extractFollowableTarget", () => {
    const slug = "some-weird-slug-123";
    const target = extractFollowableTarget(buildCompanyUrl(slug));
    expect(target).toEqual({ kind: "company", slug });
  });
});

describe("captureCompanyLoadFailure", () => {
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
        href: "https://www.linkedin.com/company/mirohq/",
        title: "Miro | LinkedIn",
        hasMain: true,
        hasH1: false,
        hasMainH1: false,
        bodyTextSnippet: "Miro\nVisual collaboration\n",
      }),
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;
  }

  it("is a no-op when LHREMOTE_CAPTURE_DIAGNOSTICS is unset", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const client = makeClient();

    await captureCompanyLoadFailure(client, "mirohq");

    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });

  it("captures DOM probes and screenshot when LHREMOTE_CAPTURE_DIAGNOSTICS=1", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();

    await captureCompanyLoadFailure(client, "mirohq");

    expect(client.evaluate).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
  });

  it("writes diagnostics with the navigate-to-company prefix (not navigate-to-profile)", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();
    const { writeFile } = await import("node:fs/promises");
    const writeFileMock = vi.mocked(writeFile);
    writeFileMock.mockClear();

    await captureCompanyLoadFailure(client, "mirohq");

    expect(writeFileMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const call of writeFileMock.mock.calls) {
      const filePath = String(call[0]);
      const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
      const filename = lastSep >= 0 ? filePath.slice(lastSep + 1) : filePath;
      expect(filename).toMatch(/^navigate-to-company-[\w.-]+\.(json|png)$/);
    }
  });
});
