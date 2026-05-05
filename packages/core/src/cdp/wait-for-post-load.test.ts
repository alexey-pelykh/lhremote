// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CDPClient } from "./client.js";

// Register the fs-promises mock BEFORE importing the module under test.
// `wait-for-post-load.ts` imports `node:fs/promises` at module load;
// relying on Vitest's vi.mock hoisting to cover this is brittle under
// ESM transforms.  Dynamic-import after the mock guarantees the mocked
// version is the one the module sees.
vi.mock("node:fs/promises", () => ({
  // mkdtemp returns the path of the freshly-created directory.  In
  // production it has a random suffix; in tests we return a stable
  // shape so assertions can match it.
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}TESTABCDEF`),
  writeFile: vi.fn().mockResolvedValue(undefined),
  // lstat/chmod back the post-mkdtemp security check that validates the
  // freshly-created diagnostics directory before writing personal data
  // into it.  Default mock returns a fresh-and-secure directory shape
  // so tests that don't care about the security path continue to pass;
  // tests that exercise the security path override this in scope.
  lstat: vi.fn().mockResolvedValue({
    isSymbolicLink: () => false,
    isDirectory: () => true,
    mode: 0o700,
  }),
  chmod: vi.fn().mockResolvedValue(undefined),
}));

// Mock the delay helper so polling iterations don't burn wall-clock
// time; the unit tests assert behavior of the deadline-driven loop, not
// of the actual delay primitive.
vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

const { capturePostLoadFailure, ensureSecureDiagnosticDir, waitForPostLoad } =
  await import("./wait-for-post-load.js");

describe("waitForPostLoad", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns immediately when readiness predicate matches on first poll", async () => {
    const evaluate = vi.fn().mockResolvedValueOnce(true);
    const client = {
      evaluate,
      send: vi.fn(),
    } as unknown as CDPClient;

    await waitForPostLoad(client);

    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("polls until readiness predicate matches", async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const client = {
      evaluate,
      send: vi.fn(),
    } as unknown as CDPClient;

    await waitForPostLoad(client);

    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it("polls with the three-stage layered readiness predicate (main-scoped author link, aria-label markers, span[dir=ltr] fallback)", async () => {
    const evaluate = vi.fn().mockResolvedValueOnce(true);
    const client = {
      evaluate,
      send: vi.fn(),
    } as unknown as CDPClient;

    await waitForPostLoad(client);

    const script = String(evaluate.mock.calls[0]?.[0] ?? "");
    // Stage 1: <main>-scoped author link (document-wide would match
    // nav/sidebar chips that hydrate before the post body).
    expect(script).toContain('main a[href*="/in/"]');
    expect(script).toContain('main a[href*="/company/"]');
    // Stage 2: aria-label-based interaction markers per ADR-007.
    expect(script).toContain('aria-label^="React Like to "');
    expect(script).toContain('aria-label^="Comment on"');
    expect(script).toContain('aria-label^="Text editor for creating"');
    // Stage 3: legacy span[dir="ltr"] fallback (defensive retention
    // in case LinkedIn restores the markup).
    expect(script).toContain('span[dir="ltr"]');
  });

  it("throws the post-detail timeout error when readiness predicate never matches before the deadline", async () => {
    const evaluate = vi.fn().mockResolvedValue(false);
    const client = {
      evaluate,
      send: vi.fn(),
    } as unknown as CDPClient;

    // Tiny timeout: with `delay` mocked to resolve immediately, the loop
    // exits within microseconds because `Date.now()` advances naturally
    // between iterations.
    await expect(waitForPostLoad(client, 1)).rejects.toThrow(
      "Timed out waiting for post detail to appear in the DOM",
    );
  });

  it("on timeout, attempts diagnostic capture before re-throwing (gated on LHREMOTE_CAPTURE_DIAGNOSTICS)", async () => {
    const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";

    // Readiness probe (`evaluate(<readiness predicate>)`) always returns
    // false; diagnostic probe (`evaluate(<diagnostics object>)`) returns
    // a probe-shaped object.  We disambiguate by inspecting the script
    // text — the diagnostic script contains "hasMainFeed".
    const evaluate = vi.fn(async (script: string) => {
      if (script.includes("hasMainFeed")) {
        return {
          href: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
          title: "Post | LinkedIn",
          hasMain: true,
          hasMainFeed: false,
          mainFeedListItemCount: 0,
          mainFeedListItemsWithMenuButton: 0,
          mainFeedListItemsViableForPostScrape: 0,
          hasAuthorLink: false,
          hasAuthorLinkInMain: false,
          hasLtrSpans: false,
          hasArticles: false,
          hasReactLikeButton: false,
          hasCommentOnButton: false,
          hasTopLevelEditor: false,
          bodyTextSnippet: "",
        };
      }
      return false;
    });
    const send = vi.fn().mockResolvedValue({ data: "aGVsbG8=" });
    const client = { evaluate, send } as unknown as CDPClient;

    try {
      await expect(waitForPostLoad(client, 1)).rejects.toThrow(
        "Timed out waiting for post detail to appear in the DOM",
      );
      // The diagnostic probe runs at least once before the timeout
      // re-throws (env=1), and `Page.captureScreenshot` is requested.
      expect(send).toHaveBeenCalledWith("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
      });
    } finally {
      if (originalEnv === undefined) {
        delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
      } else {
        process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = originalEnv;
      }
    }
  });
});

describe("capturePostLoadFailure", () => {
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
        href: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
        title: "Post | LinkedIn",
        hasMain: true,
        hasMainFeed: true,
        mainFeedListItemCount: 0,
        mainFeedListItemsWithMenuButton: 0,
        mainFeedListItemsViableForPostScrape: 0,
        hasAuthorLink: false,
        hasAuthorLinkInMain: false,
        hasLtrSpans: true,
        hasArticles: false,
        hasReactLikeButton: false,
        hasCommentOnButton: false,
        hasTopLevelEditor: false,
        bodyTextSnippet: "Post body text\n",
      }),
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;
  }

  it("is a no-op when LHREMOTE_CAPTURE_DIAGNOSTICS is unset", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const client = makeClient();

    await capturePostLoadFailure(client);

    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });

  it('is a no-op when LHREMOTE_CAPTURE_DIAGNOSTICS is any truthy-but-not-"1" value', async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "true";
    const client = makeClient();

    await capturePostLoadFailure(client);

    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });

  it("captures DOM probes and screenshot when LHREMOTE_CAPTURE_DIAGNOSTICS=1", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();

    await capturePostLoadFailure(client);

    expect(client.evaluate).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
  });

  it("probe script collects all documented fields", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();

    await capturePostLoadFailure(client);

    const script = String(vi.mocked(client.evaluate).mock.calls[0]?.[0] ?? "");
    expect(script).toContain("href");
    expect(script).toContain("title");
    expect(script).toContain("hasMain");
    expect(script).toContain("hasMainFeed");
    expect(script).toContain("mainFeedListItemCount");
    expect(script).toContain("mainFeedListItemsWithMenuButton");
    expect(script).toContain("mainFeedListItemsViableForPostScrape");
    expect(script).toContain("offsetHeight >= 100");
    expect(script).toContain("hasAuthorLink");
    // Post-#771: <main>-scoped author-link probe (separate from
    // document-wide hasAuthorLink) so a future regression can
    // distinguish "page failed entirely" from "page rendered
    // sidebar/nav chips but not the post body".
    expect(script).toContain("hasAuthorLinkInMain");
    expect(script).toContain("hasLtrSpans");
    expect(script).toContain("hasArticles");
    // Post-#771: aria-label-based interactive markers per ADR-007 —
    // exact selectors the new readiness predicate uses.
    expect(script).toContain("hasReactLikeButton");
    expect(script).toContain("hasCommentOnButton");
    expect(script).toContain("hasTopLevelEditor");
    expect(script).toContain('aria-label^="React Like to "');
    expect(script).toContain('aria-label^="Comment on"');
    expect(script).toContain('aria-label^="Text editor for creating"');
    expect(script).toContain("bodyTextSnippet");
  });

  it("swallows capture-side errors rather than masking the caller's timeout", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = {
      evaluate: vi.fn().mockRejectedValue(new Error("evaluate failed")),
      send: vi.fn(),
    } as unknown as CDPClient;

    await expect(capturePostLoadFailure(client)).resolves.toBeUndefined();
  });

  it("writes diagnostics with the wait-for-post-load prefix and .json/.png extensions", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();
    const { writeFile } = await import("node:fs/promises");
    const writeFileMock = vi.mocked(writeFile);
    writeFileMock.mockClear();

    await capturePostLoadFailure(client);

    expect(writeFileMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const call of writeFileMock.mock.calls) {
      const filePath = String(call[0]);
      const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
      const baseDir = lastSep >= 0 ? filePath.slice(0, lastSep) : "";
      const filename = lastSep >= 0 ? filePath.slice(lastSep + 1) : filePath;

      // Basename must contain no path separator (no slug input here, but
      // assert defensively in case the prefix or timestamp ever changes
      // shape).
      expect(filename).not.toMatch(/[/\\]/);
      // Filename: wait-for-post-load-{ISO}.{json|png}.  mkdtemp adds
      // randomness at the directory level, so the filename itself no
      // longer needs a random suffix.
      expect(filename).toMatch(/^wait-for-post-load-[\w.-]+\.(json|png)$/);
      // Path: ${tmpdir()}/lhremote-diagnostics-XXXXXX/{filename} — the
      // mkdtemp mock pads with a deterministic suffix in tests.  Use
      // [/\\] for the separator so the regex matches both POSIX and
      // Windows path shapes (CI runs on windows-latest too).
      expect(baseDir).toMatch(/lhremote-diagnostics-[A-Za-z0-9]+$/);
    }
  });

  it("uses mkdtemp so concurrent timeouts in the same millisecond produce distinct directories", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const { writeFile, mkdtemp } = await import("node:fs/promises");
    const writeFileMock = vi.mocked(writeFile);
    const mkdtempMock = vi.mocked(mkdtemp);
    writeFileMock.mockClear();
    mkdtempMock.mockClear();

    // Simulate the kernel's atomic uniqueness guarantee — each call
    // returns a different directory.  In production this is what the
    // OS provides via mkdtemp; we model it here so the test can
    // exercise the "two same-millisecond captures produce distinct
    // paths" property.
    let invocation = 0;
    mkdtempMock.mockImplementation(
      async (prefix) => `${prefix}TEST${(++invocation).toString().padStart(6, "0")}`,
    );

    // Pin Date.now() so two captures share the same ISO timestamp —
    // the per-call mkdtemp result is the only thing that prevents
    // collision in this case.
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    const isoSpy = vi.spyOn(Date.prototype, "toISOString").mockReturnValue(
      new Date(fixedNow).toISOString(),
    );

    try {
      await capturePostLoadFailure(makeClient());
      await capturePostLoadFailure(makeClient());

      const jsonCalls = writeFileMock.mock.calls.filter((c) =>
        String(c[0]).endsWith(".json"),
      );
      expect(jsonCalls.length).toBeGreaterThanOrEqual(2);
      const paths = jsonCalls.map((c) => String(c[0]));
      const uniquePaths = new Set(paths);
      expect(uniquePaths.size).toBe(paths.length);
    } finally {
      isoSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it("only mentions .png in the completion warning when the screenshot was actually written", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";

    // Screenshot capture rejects — info.json is the primary artifact, .png
    // is best-effort.  The console.warn must NOT promise a .png that was
    // never written, otherwise operators will look for a non-existent file.
    const client = {
      evaluate: vi.fn().mockResolvedValue({
        href: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
        title: "Post | LinkedIn",
        hasMain: true,
        hasMainFeed: false,
        mainFeedListItemCount: 0,
        mainFeedListItemsWithMenuButton: 0,
        mainFeedListItemsViableForPostScrape: 0,
        hasAuthorLink: false,
        hasAuthorLinkInMain: false,
        hasLtrSpans: false,
        hasArticles: false,
        hasReactLikeButton: false,
        hasCommentOnButton: false,
        hasTopLevelEditor: false,
        bodyTextSnippet: "",
      }),
      send: vi.fn().mockRejectedValue(new Error("captureScreenshot failed")),
    } as unknown as CDPClient;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await capturePostLoadFailure(client);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
      expect(message).toContain(".json");
      expect(message).not.toMatch(/\.\{json,png\}|\.png/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("refuses to write into a pre-existing diagnostics path that is a symlink", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const { lstat, writeFile } = await import("node:fs/promises");
    const lstatMock = vi.mocked(lstat);
    const writeFileMock = vi.mocked(writeFile);
    writeFileMock.mockClear();

    lstatMock.mockResolvedValueOnce({
      isSymbolicLink: () => true,
      isDirectory: () => false,
      mode: 0o777,
    } as Awaited<ReturnType<typeof lstat>>);

    const client = {
      evaluate: vi.fn(),
      send: vi.fn(),
    } as unknown as CDPClient;

    await capturePostLoadFailure(client);

    // Capture must have refused: no probe evaluation, no screenshot,
    // no writes — symlinks at the diagnostics path are a redirection
    // hazard.
    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("refuses to write into a pre-existing diagnostics path that is not a directory", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const { lstat, writeFile } = await import("node:fs/promises");
    const lstatMock = vi.mocked(lstat);
    const writeFileMock = vi.mocked(writeFile);
    writeFileMock.mockClear();

    lstatMock.mockResolvedValueOnce({
      isSymbolicLink: () => false,
      isDirectory: () => false,
      mode: 0o600,
    } as Awaited<ReturnType<typeof lstat>>);

    const client = {
      evaluate: vi.fn(),
      send: vi.fn(),
    } as unknown as CDPClient;

    await capturePostLoadFailure(client);

    expect(client.evaluate).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("tightens 0o755 → 0o700 on a pre-existing diagnostics directory before writing", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const { lstat, chmod } = await import("node:fs/promises");
    const lstatMock = vi.mocked(lstat);
    const chmodMock = vi.mocked(chmod);
    chmodMock.mockClear();

    lstatMock.mockResolvedValueOnce({
      isSymbolicLink: () => false,
      isDirectory: () => true,
      mode: 0o755, // group-readable & world-readable bits set
    } as Awaited<ReturnType<typeof lstat>>);

    await capturePostLoadFailure(makeClient());

    // chmod called to tighten — without this, a process with a loose
    // umask would write into a 0o755 dir other users could enumerate.
    // The matched path is the per-invocation mkdtemp output.
    expect(chmodMock).toHaveBeenCalledWith(
      expect.stringMatching(/lhremote-diagnostics-[A-Za-z0-9]+$/),
      0o700,
    );
  });

  it("refuses to write when chmod cannot tighten an over-permissive directory", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const { lstat, chmod, writeFile } = await import("node:fs/promises");
    const lstatMock = vi.mocked(lstat);
    const chmodMock = vi.mocked(chmod);
    const writeFileMock = vi.mocked(writeFile);
    writeFileMock.mockClear();

    lstatMock.mockResolvedValueOnce({
      isSymbolicLink: () => false,
      isDirectory: () => true,
      mode: 0o777,
    } as Awaited<ReturnType<typeof lstat>>);
    chmodMock.mockRejectedValueOnce(new Error("EPERM"));

    const client = {
      evaluate: vi.fn(),
      send: vi.fn(),
    } as unknown as CDPClient;

    await capturePostLoadFailure(client);

    expect(writeFileMock).not.toHaveBeenCalled();
    expect(client.evaluate).not.toHaveBeenCalled();
  });

  it("ensureSecureDiagnosticDir rejects when lstat throws", async () => {
    const { lstat } = await import("node:fs/promises");
    const lstatMock = vi.mocked(lstat);
    lstatMock.mockRejectedValueOnce(new Error("ENOENT"));

    await expect(ensureSecureDiagnosticDir("/nonexistent")).resolves.toBe(
      false,
    );
  });

  it("ensureSecureDiagnosticDir tightens 0o600 (owner-rw-only, missing owner-x) to 0o700", async () => {
    const { lstat, chmod } = await import("node:fs/promises");
    const lstatMock = vi.mocked(lstat);
    const chmodMock = vi.mocked(chmod);
    chmodMock.mockClear();

    // Under a restrictive umask, mkdtemp can produce a directory
    // missing one of the owner's rwx bits — e.g. 0o600 (owner can
    // read/write but not traverse).  The check must enforce the FULL
    // 0o700 mode, not just strip group/world bits, otherwise
    // subsequent writeFile calls inside the directory would fail.
    lstatMock.mockResolvedValueOnce({
      isSymbolicLink: () => false,
      isDirectory: () => true,
      mode: 0o600,
    } as Awaited<ReturnType<typeof lstat>>);

    await expect(ensureSecureDiagnosticDir("/some/dir")).resolves.toBe(true);
    expect(chmodMock).toHaveBeenCalledWith("/some/dir", 0o700);
  });

  it("ensureSecureDiagnosticDir accepts an existing 0o700 directory without chmod", async () => {
    const { lstat, chmod } = await import("node:fs/promises");
    const lstatMock = vi.mocked(lstat);
    const chmodMock = vi.mocked(chmod);
    chmodMock.mockClear();

    lstatMock.mockResolvedValueOnce({
      isSymbolicLink: () => false,
      isDirectory: () => true,
      mode: 0o700,
    } as Awaited<ReturnType<typeof lstat>>);

    await expect(ensureSecureDiagnosticDir("/some/dir")).resolves.toBe(true);
    expect(chmodMock).not.toHaveBeenCalled();
  });

  it("late rejection from capture body does not surface as UnhandledPromiseRejection (timer-wins race)", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";

    // Track unhandled rejections that escape the helper.  vitest also
    // detects these globally, but an explicit listener gives us a
    // deterministic assertion in this test.
    const unhandled: unknown[] = [];
    const handler = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", handler);

    // Force the timer to win the race by making setTimeout fire on the
    // microtask queue (before the inner evaluate's setImmediate-scheduled
    // rejection lands).  The cancellation flag flips, the race resolves
    // with the timer's undefined, and the inner promise's later rejection
    // would escape as UnhandledPromiseRejection unless the inner is
    // explicitly catch-attached.
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

      await capturePostLoadFailure(client);

      // Allow the late rejection to settle.
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setImmediate(r));

      expect(unhandled).toHaveLength(0);
    } finally {
      timeoutSpy.mockRestore();
      process.off("unhandledRejection", handler);
    }
  });

  it("writes JSON with mode 0o600 and creates baseDir via mkdtemp", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();
    const { writeFile, mkdtemp } = await import("node:fs/promises");
    const writeFileMock = vi.mocked(writeFile);
    const mkdtempMock = vi.mocked(mkdtemp);
    writeFileMock.mockClear();
    mkdtempMock.mockClear();

    await capturePostLoadFailure(client);

    // mkdtemp called with the lhremote-diagnostics- prefix; the random
    // suffix is generated by the kernel.  No longer mkdir(recursive),
    // which would have followed a pre-existing symlink at the parent.
    expect(mkdtempMock).toHaveBeenCalledWith(
      expect.stringMatching(/lhremote-diagnostics-$/),
    );

    // At least the .json writeFile call uses 0o600
    const jsonCall = writeFileMock.mock.calls.find((c) =>
      String(c[0]).endsWith(".json"),
    );
    expect(jsonCall).toBeDefined();
    expect(jsonCall?.[2]).toMatchObject({ mode: 0o600 });
  });
});
