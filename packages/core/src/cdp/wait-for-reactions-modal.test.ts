// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CDPClient } from "./client.js";

// Register the fs-promises mock BEFORE importing the module under test.
// `wait-for-reactions-modal.ts` imports `node:fs/promises` at module
// load; relying on Vitest's vi.mock hoisting to cover this is brittle
// under ESM transforms.  Dynamic-import after the mock guarantees the
// mocked version is the one the module sees.
vi.mock("node:fs/promises", () => ({
  // mkdtemp returns the path of the freshly-created directory.  In
  // production it has a random suffix; in tests we return a stable
  // shape so assertions can match it.
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}TESTABCDEF`),
  writeFile: vi.fn().mockResolvedValue(undefined),
  // lstat/chmod back the post-mkdtemp security check that
  // `wait-for-post-load.ts` exports as `ensureSecureDiagnosticDir` and
  // this module reuses.  Default mock returns a fresh-and-secure
  // directory shape so tests that don't care about the security path
  // continue to pass; tests that exercise the security path override
  // this in scope.
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

const { captureReactionsModalFailure, waitForReactionsModal } = await import(
  "./wait-for-reactions-modal.js"
);

describe("waitForReactionsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns immediately when readiness predicate matches on first poll", async () => {
    const evaluate = vi.fn().mockResolvedValueOnce(true);
    const client = {
      evaluate,
      send: vi.fn(),
    } as unknown as CDPClient;

    await waitForReactionsModal(client);

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

    await waitForReactionsModal(client);

    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it("polls with the resolver fallback chain (validated canonical wrappers + tab-anchor walk)", async () => {
    const evaluate = vi.fn().mockResolvedValueOnce(true);
    const client = {
      evaluate,
      send: vi.fn(),
    } as unknown as CDPClient;

    await waitForReactionsModal(client);

    const script = String(evaluate.mock.calls[0]?.[0] ?? "");
    // Resolver helper signature must appear (shared with the scrape /
    // scroll / total scripts in get-post-engagers.ts).
    expect(script).toContain("__getReactionsModal");
    // Stage 1 wrappers — sequential, ordered.  The selector list is
    // emitted as a JSON array literal so the resolver can iterate and
    // return on first match (preserving documented precedence).  The
    // assertions below use the JSON-source form (backslash-escaped
    // quotes) because that is the literal text the resolver script
    // contains; the JS engine resolves the escapes at evaluation time
    // back to `aria-modal="true"` etc.
    expect(script).toContain('"dialog"');
    expect(script).toContain('"[aria-modal=\\"true\\"]"');
    expect(script).toContain('"[role=\\"dialog\\"]"');
    // Sequential per-selector iteration — not a single comma-joined
    // `querySelector`, which would return the first match in document
    // order rather than the first match in selector-precedence order.
    expect(script).toContain("for (let i = 0;");
    expect(script).toContain("wrapperSelectors[i]");
    // Per-selector iteration over ALL matches (not just the first
    // match) — without this, an unrelated <dialog> / [aria-modal] /
    // [role=dialog] earlier in the DOM would shadow the engager modal
    // and the predicate would poll until timeout while the real
    // modal is open.
    expect(script).toContain("querySelectorAll");
    expect(script).toContain("for (let j = 0;");
    // Per-candidate validation — only accept a candidate if it
    // contains the "All reactions" tab OR an engager link.  The
    // predicate's "is this actually the engager modal?" gate.
    expect(script).toContain('aria-label$=" All reactions"');
    expect(script).toContain('a[href*="/in/"]');
    // Stage 2 fallback — tab-anchor walk reached only when no
    // canonical wrapper validated.  The tab aria-label stayed stable
    // across the 2026-05 refresh; the ancestor walk locates the modal
    // wrapper that no longer carries any of the canonical roles.
    expect(script).toContain("ancestor.parentElement");
  });

  it("throws the reactions-modal timeout error when readiness predicate never matches before the deadline", async () => {
    const evaluate = vi.fn().mockResolvedValue(false);
    const client = {
      evaluate,
      send: vi.fn(),
    } as unknown as CDPClient;

    // Tiny timeout: with `delay` mocked to resolve immediately, the loop
    // exits within microseconds because `Date.now()` advances naturally
    // between iterations.
    await expect(waitForReactionsModal(client, 1)).rejects.toThrow(
      "Timed out waiting for reactions modal to appear",
    );
  });

  it("on timeout, attempts diagnostic capture before re-throwing (gated on LHREMOTE_CAPTURE_DIAGNOSTICS)", async () => {
    const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";

    // Readiness probe (`evaluate(<readiness predicate>)`) always returns
    // false; diagnostic probe (`evaluate(<diagnostics object>)`) returns
    // a probe-shaped object.  We disambiguate by inspecting the script
    // text — the diagnostic script contains "dialogCount".
    const evaluate = vi.fn(async (script: string) => {
      if (script.includes("dialogCount")) {
        return {
          href: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
          dialogCount: 0,
          dialogHasInLinks: false,
          dialogChildElementCount: 0,
          bodyTextSnippet: "",
          reactionsButtonAriaLabels: [],
          reactionsCountText: null,
          htmlDialogCount: 0,
          ariaModalCount: 0,
          hasReactionsTab: false,
          reactionsTabAncestorChain: [],
          resolvedModalAncestorTag: null,
        };
      }
      return false;
    });
    const send = vi.fn().mockResolvedValue({ data: "aGVsbG8=" });
    const client = { evaluate, send } as unknown as CDPClient;

    try {
      await expect(waitForReactionsModal(client, 1)).rejects.toThrow(
        "Timed out waiting for reactions modal to appear",
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

describe("captureReactionsModalFailure", () => {
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
        dialogCount: 1,
        dialogHasInLinks: false,
        dialogChildElementCount: 4,
        bodyTextSnippet: "Reactions\n",
        reactionsButtonAriaLabels: ["React Like to post by Alice"],
        reactionsCountText: "42 reactions",
        htmlDialogCount: 0,
        ariaModalCount: 1,
        hasReactionsTab: true,
        reactionsTabAncestorChain: [
          "div role=tablist inLinks=0",
          "div .artdeco-modal__content inLinks=24",
        ],
        resolvedModalAncestorTag: "div",
      }),
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;
  }

  it("is a no-op when LHREMOTE_CAPTURE_DIAGNOSTICS is unset", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const client = makeClient();

    await captureReactionsModalFailure(client);

    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });

  it('is a no-op when LHREMOTE_CAPTURE_DIAGNOSTICS is any truthy-but-not-"1" value', async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "true";
    const client = makeClient();

    await captureReactionsModalFailure(client);

    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });

  it("captures DOM probes and screenshot when LHREMOTE_CAPTURE_DIAGNOSTICS=1", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();

    await captureReactionsModalFailure(client);

    expect(client.evaluate).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
  });

  it("probe script collects all documented fields", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();

    await captureReactionsModalFailure(client);

    const script = String(vi.mocked(client.evaluate).mock.calls[0]?.[0] ?? "");
    // Original probe-shape fields (#773 Phase 1 issue body baseline).
    expect(script).toContain("href");
    expect(script).toContain("dialogCount");
    expect(script).toContain("dialogHasInLinks");
    expect(script).toContain("dialogChildElementCount");
    expect(script).toContain("bodyTextSnippet");
    expect(script).toContain("reactionsButtonAriaLabels");
    expect(script).toContain("reactionsCountText");
    // Phase 2 expansion — wrapper-shape probes that distinguish
    // "modal not opened" from "modal opened with non-canonical wrapper".
    expect(script).toContain("htmlDialogCount");
    expect(script).toContain("ariaModalCount");
    expect(script).toContain("hasReactionsTab");
    expect(script).toContain("reactionsTabAncestorChain");
    expect(script).toContain("resolvedModalAncestorTag");
    // Selectors the predicate / resolver use must appear verbatim in
    // the probe so the diagnostic and the resolution rule stay aligned.
    expect(script).toContain('[role="dialog"]');
    expect(script).toContain('a[href*="/in/"]');
    // Resolver helper signature — probe re-uses RESOLVE_REACTIONS_MODAL_SCRIPT.
    expect(script).toContain("__getReactionsModal");
    // FIND_REACTIONS_SCRIPT regex shape — the probe re-uses it so a
    // future update there is reflected in diagnostics without a
    // separate change.
    expect(script).toContain("reactions?");
  });

  it("swallows capture-side errors rather than masking the caller's timeout", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = {
      evaluate: vi.fn().mockRejectedValue(new Error("evaluate failed")),
      send: vi.fn(),
    } as unknown as CDPClient;

    await expect(captureReactionsModalFailure(client)).resolves.toBeUndefined();
  });

  it("writes diagnostics with the wait-for-reactions-modal prefix and .json/.png extensions", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();
    const { writeFile } = await import("node:fs/promises");
    const writeFileMock = vi.mocked(writeFile);
    writeFileMock.mockClear();

    await captureReactionsModalFailure(client);

    expect(writeFileMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const call of writeFileMock.mock.calls) {
      const filePath = String(call[0]);
      const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
      const baseDir = lastSep >= 0 ? filePath.slice(0, lastSep) : "";
      const filename = lastSep >= 0 ? filePath.slice(lastSep + 1) : filePath;

      // Basename must contain no path separator.
      expect(filename).not.toMatch(/[/\\]/);
      // Filename: wait-for-reactions-modal-{ISO}.{json|png}.  mkdtemp
      // adds randomness at the directory level, so the filename itself
      // no longer needs a random suffix.
      expect(filename).toMatch(
        /^wait-for-reactions-modal-[\w.-]+\.(json|png)$/,
      );
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

    let invocation = 0;
    mkdtempMock.mockImplementation(
      async (prefix) => `${prefix}TEST${(++invocation).toString().padStart(6, "0")}`,
    );

    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    const isoSpy = vi.spyOn(Date.prototype, "toISOString").mockReturnValue(
      new Date(fixedNow).toISOString(),
    );

    try {
      await captureReactionsModalFailure(makeClient());
      await captureReactionsModalFailure(makeClient());

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

    const client = {
      evaluate: vi.fn().mockResolvedValue({
        href: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
        dialogCount: 0,
        dialogHasInLinks: false,
        dialogChildElementCount: 0,
        bodyTextSnippet: "",
        reactionsButtonAriaLabels: [],
        reactionsCountText: null,
        htmlDialogCount: 0,
        ariaModalCount: 0,
        hasReactionsTab: false,
        reactionsTabAncestorChain: [],
        resolvedModalAncestorTag: null,
      }),
      send: vi.fn().mockRejectedValue(new Error("captureScreenshot failed")),
    } as unknown as CDPClient;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await captureReactionsModalFailure(client);

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

    await captureReactionsModalFailure(client);

    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("writes JSON with mode 0o600 and creates baseDir via mkdtemp", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();
    const { writeFile, mkdtemp } = await import("node:fs/promises");
    const writeFileMock = vi.mocked(writeFile);
    const mkdtempMock = vi.mocked(mkdtemp);
    writeFileMock.mockClear();
    mkdtempMock.mockClear();

    await captureReactionsModalFailure(client);

    expect(mkdtempMock).toHaveBeenCalledWith(
      expect.stringMatching(/lhremote-diagnostics-$/),
    );

    const jsonCall = writeFileMock.mock.calls.find((c) =>
      String(c[0]).endsWith(".json"),
    );
    expect(jsonCall).toBeDefined();
    expect(jsonCall?.[2]).toMatchObject({ mode: 0o600 });
  });

  it("late rejection from capture body does not surface as UnhandledPromiseRejection (timer-wins race)", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";

    const unhandled: unknown[] = [];
    const handler = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", handler);

    // Force the timer to win the race by making setTimeout fire on the
    // microtask queue (before the inner evaluate's setImmediate-scheduled
    // rejection lands).
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

      await captureReactionsModalFailure(client);

      // Allow the late rejection to settle.
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setImmediate(r));

      expect(unhandled).toHaveLength(0);
    } finally {
      timeoutSpy.mockRestore();
      process.off("unhandledRejection", handler);
    }
  });
});
