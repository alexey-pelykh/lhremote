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
const { adaptersFor, buildReadinessPredicateSource, formatVariantProbes } =
  await import("../linkedin/dom-variant.js");
const {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
  ExtractionTimeoutError,
} = await import("../services/errors.js");

/** No detect probe was taken — the shape every pre-#840 case implied. */
const NO_DETECTION = { detection: null } as const;

/**
 * A `Runtime.evaluate` double that answers by SCRIPT SHAPE rather than by call
 * position, because the deadline path now evaluates three different scripts in
 * a row (readiness predicate, detect probe, diagnostic probe) and a positional
 * mock would silently mis-assign them the moment one is added.
 */
function evaluateBy(answers: {
  readiness?: boolean;
  detection?: unknown;
  probe?: unknown;
}) {
  return vi.fn(async (script: string) => {
    if (script.includes("dialogCount")) return answers.probe ?? DIAGNOSTIC_PROBE;
    if (script.includes("probes[a.variant]")) return answers.detection ?? null;
    return answers.readiness ?? false;
  });
}

const DIAGNOSTIC_PROBE = {
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

  it("polls the predicate generated from the reactions-modal registry", async () => {
    const evaluate = vi.fn().mockResolvedValueOnce(true);
    const client = {
      evaluate,
      send: vi.fn(),
    } as unknown as CDPClient;

    await waitForReactionsModal(client);

    // Byte-identical to what the registry emits, which is the assertion that
    // matters: a predicate merely *resembling* the generated one is exactly
    // the second copy ADR-008 § Decision 1 exists to prevent.
    expect(String(evaluate.mock.calls[0]?.[0] ?? "")).toBe(
      buildReadinessPredicateSource(adaptersFor("reactions-modal")),
    );
  });

  it("no longer requires an engager link, so a genuinely empty modal is ready", async () => {
    // The predicate this replaced asked whether at least one engager profile
    // link had appeared.  That is a ROW-tier question and it cannot go green on
    // a modal holding nobody, so a zero-reaction post timed out on a modal that
    // had opened perfectly.  Readiness now stops at the container tier and the
    // cardinal tier decides what an empty list means (#840).
    const script = buildReadinessPredicateSource(adaptersFor("reactions-modal"));
    expect(script).not.toContain('a[href*="/in/"]');
  });

  it("raises a typed timeout when exactly one adapter claims the page but never renders", async () => {
    // The dialect is known and the modal simply never appeared — which is a
    // different repair from "register an adapter", so it is a different class.
    const client = {
      evaluate: evaluateBy({
        detection: { matched: ["legacy"], probes: { sdui: 0, legacy: 1 } },
      }),
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;

    // Tiny timeout: with `delay` mocked to resolve immediately, the loop
    // exits within microseconds because `Date.now()` advances naturally
    // between iterations.
    await expect(waitForReactionsModal(client, 1)).rejects.toThrow(
      ExtractionTimeoutError,
    );
  });

  it("raises unsupported when no adapter claims the page at the deadline", async () => {
    const client = {
      evaluate: evaluateBy({
        detection: { matched: [], probes: { sdui: 0, legacy: 0 } },
      }),
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;

    await expect(waitForReactionsModal(client, 1)).rejects.toThrow(
      DOMVariantUnsupportedError,
    );
  });

  it("attaches the detect probe counts as the unsupported error's cause", async () => {
    // The class and its own wording come from `errors.ts`; the per-adapter
    // probe counts come from HERE, and nothing else asserts them.  Deleting
    // `{ cause: … }` from the branch above leaves the class-only test green
    // while silently dropping the diagnosis that reaches CLI stderr and the
    // MCP tool response text.
    //
    // The WHOLE message is pinned rather than a substring of it, because what
    // a cause may hold is a privacy boundary: `errorMessage` renders it with
    // no gate in front of it, and `error-message.ts` keeps page content in the
    // `LHREMOTE_CAPTURE_DIAGNOSTICS`-gated bundle instead — noting that this
    // is "a property of the producers, not something checked here".  This is a
    // producer.  A `toContain` would accept a message that appended a scrape.
    //
    // The probe half is derived THROUGH `formatVariantProbes` rather than
    // written as a look-alike literal, so a change to that rendering cannot
    // strand a stale expectation here.  The formatter itself is separately
    // pinned against literals in `dom-variant.test.ts`; the subject here is
    // only whether production attaches a cause carrying it.
    const detection = { matched: [], probes: { sdui: 0, legacy: 0 } };
    const client = {
      evaluate: evaluateBy({ detection }),
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;

    const error = await waitForReactionsModal(client, 1).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(DOMVariantUnsupportedError);
    // `as Error` rather than the concrete subclass, unlike the sibling gates'
    // tests: this file reaches its error classes through `await import`, so
    // they are values here and not types and the narrower cast is unavailable.
    // `cause` is declared on `Error` anyway, and the subclass identity is
    // already pinned on the line above.
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toBe(
      `detect probes — ${formatVariantProbes(detection)}`,
    );
  });

  it("raises ambiguous when two adapters claim the page at the deadline", async () => {
    const client = {
      evaluate: evaluateBy({
        detection: { matched: ["sdui", "legacy"], probes: { sdui: 1, legacy: 1 } },
      }),
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;

    await expect(waitForReactionsModal(client, 1)).rejects.toThrow(
      DOMVariantAmbiguousError,
    );
  });

  it("attaches the detect probe counts as the ambiguous error's cause", async () => {
    // A second, separate `{ cause: … }` site, so a separate pin: deleting
    // either one alone has to be caught, which one test spanning both branches
    // could not do.  The two counts differ on purpose — a symmetric
    // expectation would also be satisfied by a cause built from some other
    // symmetric detection.  Whole-message pin, derived probe text and `as
    // Error` for the reasons the sibling test above states.
    const detection = {
      matched: ["sdui", "legacy"],
      probes: { sdui: 3, legacy: 7 },
    };
    const client = {
      evaluate: evaluateBy({ detection }),
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;

    const error = await waitForReactionsModal(client, 1).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(DOMVariantAmbiguousError);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toBe(
      `detect probes — ${formatVariantProbes(detection)}`,
    );
  });

  it("falls back to the ordinary timeout when the classification probe is malformed", async () => {
    // A probe that did not run usefully is NOT the claim "no adapter matched".
    // Reading it as one would blame LinkedIn for a broken instrument.
    const client = {
      evaluate: evaluateBy({ detection: { matched: "not-an-array" } }),
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;

    await expect(waitForReactionsModal(client, 1)).rejects.toThrow(
      ExtractionTimeoutError,
    );
  });

  it("on failure, attempts diagnostic capture before re-throwing (gated on LHREMOTE_CAPTURE_DIAGNOSTICS)", async () => {
    const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";

    const evaluate = evaluateBy({
      detection: { matched: [], probes: { sdui: 0, legacy: 0 } },
    });
    const send = vi.fn().mockResolvedValue({ data: "aGVsbG8=" });
    const client = { evaluate, send } as unknown as CDPClient;

    try {
      await expect(waitForReactionsModal(client, 1)).rejects.toThrow(
        DOMVariantUnsupportedError,
      );
      // The diagnostic probe runs before the error re-throws (env=1), and
      // `Page.captureScreenshot` is requested.
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

  it("records the detect probe it classified from in the bundle it writes", async () => {
    const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const { writeFile } = await import("node:fs/promises");
    vi.mocked(writeFile).mockClear();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const client = {
      evaluate: evaluateBy({
        detection: { matched: [], probes: { sdui: 0, legacy: 0 } },
      }),
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;

    try {
      await expect(waitForReactionsModal(client, 1)).rejects.toThrow();

      const jsonCall = vi
        .mocked(writeFile)
        .mock.calls.find((call) => String(call[0]).endsWith(".json"));
      // One read feeds both the error's cause and the bundle, so the two can
      // never disagree about what was on the page.
      expect(
        JSON.parse(String(jsonCall?.[1])) as Record<string, unknown>,
      ).toMatchObject({
        trigger: "readiness-timeout",
        variantDetection: { matched: [], probes: { sdui: 0, legacy: 0 } },
      });
    } finally {
      warnSpy.mockRestore();
      if (originalEnv === undefined) {
        delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
      } else {
        process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = originalEnv;
      }
    }
  });
});

describe("captureReactionsModalFailure", () => {
  // The readiness-timeout context every case below implicitly used before
  // #835 widened the capture to carry its trigger.  Pinned as a constant so
  // these cases keep asserting the timeout capture's behaviour UNCHANGED, and
  // the new extraction-failure trigger is exercised only where a test names
  // it.
  const TIMEOUT_CAPTURE = {
    trigger: "readiness-timeout",
    ...NO_DETECTION,
  } as const;

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

    await captureReactionsModalFailure(client, TIMEOUT_CAPTURE);

    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });

  it('is a no-op when LHREMOTE_CAPTURE_DIAGNOSTICS is any truthy-but-not-"1" value', async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "true";
    const client = makeClient();

    await captureReactionsModalFailure(client, TIMEOUT_CAPTURE);

    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });

  it("captures DOM probes and screenshot when LHREMOTE_CAPTURE_DIAGNOSTICS=1", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();

    await captureReactionsModalFailure(client, TIMEOUT_CAPTURE);

    expect(client.evaluate).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
  });

  it("probe script collects all documented fields", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();

    await captureReactionsModalFailure(client, TIMEOUT_CAPTURE);

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
    // As a JSON string literal, not hand-quoted: every selector CONSTANT this
    // module interpolates goes through the shared `jsString` helper (#875;
    // a bare `JSON.stringify` per site before that), because a selector that
    // grows a single quote or a backslash would otherwise emit a syntax error
    // the capture's own `.catch` swallows — no json, no png, no warn line, at
    // the one moment diagnostics matter (#840).  Asserted here as
    // `JSON.stringify` deliberately: the expectation must state the form
    // independently of the call the module made.
    expect(script).toContain(JSON.stringify('a[href*="/in/"]'));
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

    await expect(captureReactionsModalFailure(client, TIMEOUT_CAPTURE)).resolves.toBeUndefined();
  });

  it("writes diagnostics with the wait-for-reactions-modal prefix and .json/.png extensions", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();
    const { writeFile } = await import("node:fs/promises");
    const writeFileMock = vi.mocked(writeFile);
    writeFileMock.mockClear();

    await captureReactionsModalFailure(client, TIMEOUT_CAPTURE);

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
      await captureReactionsModalFailure(makeClient(), TIMEOUT_CAPTURE);
      await captureReactionsModalFailure(makeClient(), TIMEOUT_CAPTURE);

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
      await captureReactionsModalFailure(client, TIMEOUT_CAPTURE);

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

    await captureReactionsModalFailure(client, TIMEOUT_CAPTURE);

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

    await captureReactionsModalFailure(client, TIMEOUT_CAPTURE);

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

      await captureReactionsModalFailure(client, TIMEOUT_CAPTURE);

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

// ───────────────────────────────────────────────────────────────────────────
// #835 — the capture is no longer bound to a deadline, so the bundle carries
// the trigger that fired it.  The claim that stood here alongside it — that
// the reactions modal has no registry entry, so the bundle can carry no
// per-adapter detect counts — was answered by #830 and is false as of #840:
// the surface is registered and `variantDetection` is a real reading.  Every
// case below passes `detection: null` deliberately, which records "no probe
// was taken" rather than "nothing matched", and pins that these artifact
// names and warn strings did not move.
// ───────────────────────────────────────────────────────────────────────────

describe("captureReactionsModalFailure — trigger (#835)", () => {
  const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;

  const PROBE = {
    href: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
    dialogCount: 1,
    dialogHasInLinks: true,
    dialogChildElementCount: 4,
    bodyTextSnippet: "2 reactions\n",
    reactionsButtonAriaLabels: ["Open reactions menu"],
    reactionsCountText: "2 reactions",
    htmlDialogCount: 1,
    ariaModalCount: 1,
    hasReactionsTab: true,
    reactionsTabAncestorChain: ["div role=dialog inLinks=0"],
    resolvedModalAncestorTag: "div",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
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
      evaluate: vi.fn().mockResolvedValue(PROBE),
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;
  }

  async function captureWith(
    trigger: "readiness-timeout" | "extraction-failure",
  ): Promise<{ bundle: Record<string, unknown>; path: string }> {
    const { writeFile } = await import("node:fs/promises");
    const writeFileMock = vi.mocked(writeFile);
    writeFileMock.mockClear();

    await captureReactionsModalFailure(makeClient(), {
      trigger,
      ...NO_DETECTION,
    });

    const jsonCall = writeFileMock.mock.calls.find((call) =>
      String(call[0]).endsWith(".json"),
    );
    expect(jsonCall).toBeDefined();
    return {
      bundle: JSON.parse(String(jsonCall?.[1])) as Record<string, unknown>,
      path: String(jsonCall?.[0]),
    };
  }

  it("keeps the readiness-timeout artifact name and warn wording unchanged", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const { bundle, path } = await captureWith("readiness-timeout");

    // Regression pin: widening the trigger must not rename the artifact
    // operators already know.
    expect(path).toContain("wait-for-reactions-modal-");
    expect(bundle).toMatchObject({
      trigger: "readiness-timeout",
      dialogCount: 1,
    });
    expect(String(warnSpy.mock.calls[0]?.[0] ?? "")).toContain(
      "[waitForReactionsModal] timeout diagnostics written:",
    );
    warnSpy.mockRestore();
  });

  it("names the extraction-failure artifact and warn line for what failed", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const { bundle, path } = await captureWith("extraction-failure");

    // The modal opened and rendered engager links — the readiness gate went
    // green.  Labelling this a timeout would misdirect the next reader.
    expect(path).toContain("reactions-modal-extraction-failure-");
    expect(bundle.trigger).toBe("extraction-failure");
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(message).toContain("[reactionsModalExtraction]");
    expect(message).toContain("extraction-failure diagnostics written:");
    // Acceptance: the warn still carries the real artifact directory.
    expect(message).toContain(path.replace(/\.json$/, ""));
    warnSpy.mockRestore();
  });

  it("stays default-off on the extraction-failure trigger too", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const client = makeClient();

    await captureReactionsModalFailure(client, {
      trigger: "extraction-failure",
      ...NO_DETECTION,
    });

    // Widening the trigger must not widen the gate: the artifacts carry
    // engager names and profile slugs on every trigger alike.
    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The TS→JS seam in the diagnostic probe (#840)
// ───────────────────────────────────────────────────────────────────────────
//
// The probe source is a JavaScript program inside a TypeScript template
// literal, and nothing in the type system notices when that goes wrong.  A
// hand-quoted `'${SELECTOR}'` compiles, lints, and emits either a syntax error
// or a valid-but-DIFFERENT selector; round 1 fixed seven such sites in this
// module, and nothing stopped an eighth from being written.
//
// The consequence is worse here than at any other site, because this source
// runs only when something has ALREADY failed and the capture swallows its own
// errors: a probe that does not parse produces no json, no png and no warn
// line, at the one moment an operator is reading diagnostics.  `probe script
// collects all documented fields` above pins the probe's SHAPE; this pins that
// it is a program at all, and that the selectors reached it intact.
describe("reactions-modal diagnostic probe — emitted-source integrity", () => {
  const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;

  /**
   * The selectors this module INTERPOLATES into the probe.
   *
   * All three are module-private constants with no public accessor, so they
   * are restated here rather than exported purely to be asserted on — which
   * makes this an independent statement of what they are, not a tautology
   * against the module's own values.
   */
  const REACTIONS_TAB_FALLBACK = 'button[aria-label$=" All reactions"]';
  const ENGAGER_LINK = 'a[href*="/in/"]';
  const WRAPPERS = ["dialog", '[aria-modal="true"]', '[role="dialog"]'];

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

  /** The probe source as the capture actually hands it to `Runtime.evaluate`. */
  async function emittedProbeSource(): Promise<string> {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = {
      evaluate: vi.fn().mockResolvedValue({}),
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await captureReactionsModalFailure(client, {
      trigger: "readiness-timeout",
      ...NO_DETECTION,
    });

    warnSpy.mockRestore();
    const source = String(vi.mocked(client.evaluate).mock.calls[0]?.[0] ?? "");
    // Cardinality, not just content: an empty source would satisfy every
    // `not.toContain` below without a single assertion having graded anything.
    expect(source.length).toBeGreaterThan(0);
    return source;
  }

  it("parses as JavaScript", async () => {
    const source = await emittedProbeSource();

    // The failure this catches is invisible by construction: the capture's own
    // `.catch` swallows an evaluate that throws, so a source that is not a
    // program looks exactly like a page that had nothing to report.
    expect(() => new Function(source)).not.toThrow();
  });

  it("carries the reactions-tab fallback selector in its JSON form", async () => {
    const source = await emittedProbeSource();

    // Pinned by nothing before this. The selector is the ONLY anchor recorded
    // present on the 2026-05 engager modal, and both the resolver's stage-1
    // gate and its stage-2 walk start from it, so a silent break here takes
    // the whole diagnostic with it.
    expect(source).toContain(JSON.stringify(REACTIONS_TAB_FALLBACK));
  });

  it("hand-quotes neither of the two per-selector interpolations", async () => {
    const source = await emittedProbeSource();

    // Deliberately the two CONSTANTS this module interpolates one at a time,
    // and not the wrapper members: those go in as a whole array (pinned
    // below), and the same three strings also appear in the probe as
    // hand-written one-off selectors — the legacy `[role="dialog"]` probe and
    // the `dialog` / `[aria-modal="true"]` shape counts. Those are literals in
    // the emitted program rather than values crossing the seam, so a
    // hand-quote rule over them would fail on correct code.
    for (const selector of [REACTIONS_TAB_FALLBACK, ENGAGER_LINK]) {
      expect(source, `hand-quoted ${selector}`).not.toContain(`'${selector}'`);
    }
  });

  it("carries the wrapper precedence list as a JSON array literal", async () => {
    const source = await emittedProbeSource();

    // The list is interpolated whole rather than per entry, and its ORDER is
    // the resolver's precedence rule — so the array literal, not the members,
    // is the thing to pin.
    expect(source).toContain(JSON.stringify(WRAPPERS));
  });
});
