// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adaptersFor,
  buildDetectionSource,
  buildReadinessPredicateSource,
} from "../linkedin/dom-variant.js";
import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
  ExtractionTimeoutError,
} from "../services/errors.js";

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

const {
  capturePostLoadFailure,
  diagnosticCaptureEnabled,
  ensureSecureDiagnosticDir,
  probeVariantDetection,
  waitForPostLoad,
} = await import("./wait-for-post-load.js");

/**
 * A selector fragment as it appears INSIDE the emitted JS string literal.
 *
 * Since #875 the module interpolates its selector constants through
 * `jsString`, so a fragment carrying double quotes reaches the emitted source
 * escaped.  `JSON.stringify(...).slice(1, -1)` drops the wrapping quotes and
 * keeps the escaping — which is exactly a fragment's form once embedded.
 *
 * Deliberately `JSON.stringify` rather than the module's own `jsString`: the
 * expectation must be an INDEPENDENT statement of the form the source should
 * carry, not the same call the source made.  Grading `jsString` output against
 * `jsString` would pass for any implementation, including a broken one.
 */
function escaped(fragment: string): string {
  return JSON.stringify(fragment).slice(1, -1);
}

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

  it("polls the readiness predicate generated from the post-detail adapter registry", async () => {
    const evaluate = vi.fn().mockResolvedValueOnce(true);
    const client = {
      evaluate,
      send: vi.fn(),
    } as unknown as CDPClient;

    await waitForPostLoad(client);

    const script = String(evaluate.mock.calls[0]?.[0] ?? "");
    // The predicate is the registry's, not a hand-written disjunction:
    // every registered adapter's detect and ready anchors appear in it.
    // Anchors are emitted as JSON string literals — selectors legitimately
    // contain the quote characters that hand-quoting would break on.
    for (const adapter of adaptersFor("post-detail")) {
      expect(script).toContain(JSON.stringify(adapter.detect));
      expect(script).toContain(JSON.stringify(adapter.ready));
    }
    expect(script).toBe(
      buildReadinessPredicateSource(adaptersFor("post-detail")),
    );
  });

  it("no longer gates on the variant-agnostic author link that went green on an unreadable page", async () => {
    const evaluate = vi.fn().mockResolvedValueOnce(true);
    const client = {
      evaluate,
      send: vi.fn(),
    } as unknown as CDPClient;

    await waitForPostLoad(client);

    // The regression this closes: `main a[href*="/in/"]` was the required
    // first stage of the old predicate and was chosen *because* it survives
    // markup change.  Measured 2026-08-31 it matched 85 elements on a page
    // where every scraper selector matched 0, so the gate passed a page the
    // extractor could not read.  An anchor that survives every markup change
    // cannot detect a markup change, so it must not gate variant-specific
    // extraction.  It stays in the *diagnostic* probe, which this asserts
    // nothing about.
    // Matched quote-insensitively so the assertion survives the anchors
    // being emitted as escaped JSON string literals.
    const script = String(evaluate.mock.calls[0]?.[0] ?? "");
    expect(script).not.toContain("main a[href*=");
  });

  it("requires the SELECTED adapter's own ready anchor, not any adapter's", async () => {
    // Grades the generated predicate directly, in a DOM-less evaluator: the
    // page is modelled as a set of selectors that match.  A page speaking
    // dialect A whose *ready* anchor is absent must not be gated green by
    // dialect B's ready anchor being present.
    const [first, second] = adaptersFor("post-detail");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const script = buildReadinessPredicateSource(adaptersFor("post-detail"));

    const run = (present: readonly string[]): unknown =>
      new Function(
        "document",
        `return ${script};`,
      )({
        querySelector: (sel: string) => (present.includes(sel) ? {} : null),
        querySelectorAll: (sel: string) => (present.includes(sel) ? [{}] : []),
      });

    // Only the first adapter's detect anchor is present, and its own ready
    // anchor is not — but the *second* adapter's ready anchor is.
    expect(
      run([first?.detect ?? "", second?.ready ?? ""].filter(Boolean)),
    ).toBe(false);
    // The first adapter's own ready anchor present -> green.
    expect(run([first?.detect ?? "", first?.ready ?? ""])).toBe(true);
  });

  it("stays red while the page is ambiguous (two dialects claim it)", async () => {
    const adapters = adaptersFor("post-detail");
    const script = buildReadinessPredicateSource(adapters);
    const present = adapters.flatMap((a) => [a.detect, a.ready]);

    const ready = new Function(
      "document",
      `return ${script};`,
    )({
      querySelector: (sel: string) => (present.includes(sel) ? {} : null),
      querySelectorAll: (sel: string) => (present.includes(sel) ? [{}] : []),
    });

    // Every anchor of every adapter matches, so a naive disjunction would go
    // green.  Selection requires exactly one claimant, so this stays red and
    // the deadline classifies it as ambiguous rather than picking a dialect.
    expect(ready).toBe(false);
  });

  it("raises DOMVariantUnsupportedError when no adapter claims the page at the deadline", async () => {
    const evaluate = vi.fn(async (script: string) =>
      script.includes("probes") ? { matched: [], probes: { sdui: 0, legacy: 0 } } : false,
    );
    const client = { evaluate, send: vi.fn() } as unknown as CDPClient;

    const rejection = waitForPostLoad(client, 1);

    await expect(rejection).rejects.toThrow(DOMVariantUnsupportedError);
    await expect(rejection).rejects.toThrow(
      /No DOM adapter matched the post-detail page/,
    );
  });

  it("raises DOMVariantAmbiguousError when two adapters claim the page at the deadline", async () => {
    const evaluate = vi.fn(async (script: string) =>
      script.includes("probes")
        ? { matched: ["sdui", "legacy"], probes: { sdui: 1, legacy: 1 } }
        : false,
    );
    const client = { evaluate, send: vi.fn() } as unknown as CDPClient;

    const rejection = waitForPostLoad(client, 1);

    await expect(rejection).rejects.toThrow(DOMVariantAmbiguousError);
    await expect(rejection).rejects.toThrow(
      /Multiple DOM adapters matched the post-detail page/,
    );
  });

  it("raises the plain timeout when exactly one adapter claims the page but never becomes ready", async () => {
    // The dialect IS known — this genuinely timed out, and calling it
    // "LinkedIn changed" would send the operator to write an adapter that
    // already exists.
    const evaluate = vi.fn(async (script: string) =>
      script.includes("probes")
        ? { matched: ["sdui"], probes: { sdui: 1, legacy: 0 } }
        : false,
    );
    const client = { evaluate, send: vi.fn() } as unknown as CDPClient;

    await expect(waitForPostLoad(client, 1)).rejects.toThrow(
      ExtractionTimeoutError,
    );
  });

  it("falls back to the plain timeout when the classification probe throws", async () => {
    // A throwing probe is the same non-evidence as a malformed one. Letting
    // it escape would swap the caller's timeout for an unrelated evaluate
    // error and skip the diagnostic capture — the one artifact that would
    // explain the failure.
    const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const evaluate = vi.fn(async (script: string) => {
      if (script.includes("probes")) throw new Error("probe blew up");
      if (script.includes("hasMainFeed")) return { href: "", title: "" };
      return false;
    });
    const send = vi.fn().mockResolvedValue({ data: "aGVsbG8=" });
    const client = { evaluate, send } as unknown as CDPClient;

    try {
      const rejection = waitForPostLoad(client, 1);

      await expect(rejection).rejects.toThrow(ExtractionTimeoutError);
      await expect(rejection).rejects.not.toThrow(/probe blew up/);
      // Diagnostics still ran despite the probe failing.
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

  it("falls back to the plain timeout when the classification probe is malformed", async () => {
    // A probe result that is not well-formed says the probe did not run
    // usefully — it is not evidence that LinkedIn changed.  Reporting
    // "no adapter matched" off a broken instrument would blame the page for
    // a local failure.
    const evaluate = vi.fn().mockResolvedValue(undefined);
    const client = { evaluate, send: vi.fn() } as unknown as CDPClient;

    const rejection = waitForPostLoad(client, 1);

    await expect(rejection).rejects.toThrow(ExtractionTimeoutError);
    await expect(rejection).rejects.not.toThrow(DOMVariantUnsupportedError);
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
    // Both assertions grade ONE invocation: the timeout loop runs once and the
    // settled rejection is asserted against twice. Re-invoking would re-run
    // the loop, doubling the wall-clock cost and the flakiness surface.
    const rejection = waitForPostLoad(client, 1);

    await expect(rejection).rejects.toThrow(ExtractionTimeoutError);
    await expect(rejection).rejects.toThrow(/Post-detail extraction timed out/);
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
          hasReactionsMenu: false,
          hasPostDetailContainer: false,
          bodyTextSnippet: "",
        };
      }
      return false;
    });
    const send = vi.fn().mockResolvedValue({ data: "aGVsbG8=" });
    const client = { evaluate, send } as unknown as CDPClient;

    try {
      await expect(waitForPostLoad(client, 1)).rejects.toThrow(
        ExtractionTimeoutError,
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

  it("on timeout, the bundle carries the same detection the error was classified from (#835)", async () => {
    const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const { writeFile } = await import("node:fs/promises");
    const writeFileMock = vi.mocked(writeFile);
    writeFileMock.mockClear();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    // Zero adapters claim the page: the classification probe decides
    // DOMVariantUnsupportedError, and the SAME reading must reach the bundle.
    const evaluate = vi.fn(async (script: string) => {
      if (script.includes("probes")) {
        return { matched: [], probes: { sdui: 0, legacy: 0 } };
      }
      if (script.includes("hasMainFeed")) return { href: "", title: "" };
      return false;
    });
    const client = {
      evaluate,
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;

    try {
      await expect(waitForPostLoad(client, 1)).rejects.toThrow(
        DOMVariantUnsupportedError,
      );

      const jsonCall = writeFileMock.mock.calls.find((call) =>
        String(call[0]).endsWith(".json"),
      );
      expect(jsonCall).toBeDefined();
      // One probe feeds both the error's `cause` and the artifact, so an
      // operator reading the two side by side can never be shown two
      // different accounts of the same page.
      expect(
        JSON.parse(String(jsonCall?.[1])) as Record<string, unknown>,
      ).toMatchObject({
        trigger: "readiness-timeout",
        variantDetection: { matched: [], probes: { sdui: 0, legacy: 0 } },
      });
      // Exactly one detect probe: the capture reuses the classification's
      // reading rather than taking a second, later one.
      const detectCalls = evaluate.mock.calls.filter((call) =>
        String(call[0]).includes("probes"),
      );
      expect(detectCalls).toHaveLength(1);
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

describe("capturePostLoadFailure", () => {
  // The readiness-timeout context every case below implicitly used before
  // #835 widened the capture to carry its trigger.  Pinned as a constant so
  // these cases keep asserting the timeout capture's behaviour UNCHANGED —
  // filename stem, warn wording and all — and the new extraction-failure
  // trigger is exercised only where a test names it.
  const TIMEOUT_CAPTURE = {
    trigger: "readiness-timeout",
    detection: null,
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
        hasReactionsMenu: false,
        hasPostDetailContainer: false,
        commentElementCount: 0,
        bodyTextSnippet: "Post body text\n",
      }),
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;
  }

  it("is a no-op when LHREMOTE_CAPTURE_DIAGNOSTICS is unset", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const client = makeClient();

    await capturePostLoadFailure(client, TIMEOUT_CAPTURE);

    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });

  it('is a no-op when LHREMOTE_CAPTURE_DIAGNOSTICS is any truthy-but-not-"1" value', async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "true";
    const client = makeClient();

    await capturePostLoadFailure(client, TIMEOUT_CAPTURE);

    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });

  it("captures DOM probes and screenshot when LHREMOTE_CAPTURE_DIAGNOSTICS=1", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();

    await capturePostLoadFailure(client, TIMEOUT_CAPTURE);

    expect(client.evaluate).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
  });

  it("probe script collects all documented fields", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();

    await capturePostLoadFailure(client, TIMEOUT_CAPTURE);

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
    // The marker fragments below are asserted in their ESCAPED form: since
    // #875 every selector constant crosses the TS→JS seam through `jsString`,
    // so the double quotes inside each one reach the emitted source as `\"`.
    // Written as `JSON.stringify(...).slice(1, -1)` rather than as a
    // hand-escaped literal so the expectation states the transform rather than
    // its output — a hand-escaped string would drift silently the next time the
    // seam's quoting rule moves.
    expect(script).toContain(escaped('aria-label^="React Like to "'));
    expect(script).toContain(escaped('aria-label^="Comment on"'));
    expect(script).toContain(escaped('aria-label^="Text editor for creating"'));
    // lhremote#800 hardening: new SDUI readiness markers also probed
    // so a future timeout pins which-of-N-is-missing.
    expect(script).toContain("hasReactionsMenu");
    expect(script).toContain("hasPostDetailContainer");
    expect(script).toContain(escaped('aria-label="Open reactions menu"'));
    expect(script).toContain(
      escaped('[componentkey^="expanded"][componentkey$="FeedType_FEED_DETAIL"]'),
    );
    // #835: the comment layer the extraction-failure error names.  Every
    // other probe here answers a readiness question instead.
    expect(script).toContain("commentElementCount");
    expect(script).toContain(escaped('[componentkey^="replaceableComment_"]'));
    expect(script).toContain("bodyTextSnippet");
  });

  it("swallows capture-side errors rather than masking the caller's timeout", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = {
      evaluate: vi.fn().mockRejectedValue(new Error("evaluate failed")),
      send: vi.fn(),
    } as unknown as CDPClient;

    await expect(capturePostLoadFailure(client, TIMEOUT_CAPTURE)).resolves.toBeUndefined();
  });

  it("writes diagnostics with the wait-for-post-load prefix and .json/.png extensions", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const client = makeClient();
    const { writeFile } = await import("node:fs/promises");
    const writeFileMock = vi.mocked(writeFile);
    writeFileMock.mockClear();

    await capturePostLoadFailure(client, TIMEOUT_CAPTURE);

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
      await capturePostLoadFailure(makeClient(), TIMEOUT_CAPTURE);
      await capturePostLoadFailure(makeClient(), TIMEOUT_CAPTURE);

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
        hasReactionsMenu: false,
        hasPostDetailContainer: false,
        bodyTextSnippet: "",
      }),
      send: vi.fn().mockRejectedValue(new Error("captureScreenshot failed")),
    } as unknown as CDPClient;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await capturePostLoadFailure(client, TIMEOUT_CAPTURE);

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

    await capturePostLoadFailure(client, TIMEOUT_CAPTURE);

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

    await capturePostLoadFailure(client, TIMEOUT_CAPTURE);

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

    await capturePostLoadFailure(makeClient(), TIMEOUT_CAPTURE);

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

    await capturePostLoadFailure(client, TIMEOUT_CAPTURE);

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

      await capturePostLoadFailure(client, TIMEOUT_CAPTURE);

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

    await capturePostLoadFailure(client, TIMEOUT_CAPTURE);

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

// ───────────────────────────────────────────────────────────────────────────
// #835 — the capture is no longer bound to a deadline, and the bundle now
// carries the one field that distinguishes "LinkedIn served a dialect we
// don't know" from "our adapter matched but a field's selectors are stale".
// ───────────────────────────────────────────────────────────────────────────

describe("probeVariantDetection", () => {
  const ADAPTERS = adaptersFor("post-detail");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function clientReturning(value: unknown): CDPClient {
    return {
      evaluate: vi.fn().mockResolvedValue(value),
      send: vi.fn(),
    } as unknown as CDPClient;
  }

  it("narrows a well-formed probe result", async () => {
    const client = clientReturning({
      matched: ["sdui"],
      probes: { sdui: 3, legacy: 0 },
    });

    await expect(probeVariantDetection(client, ADAPTERS)).resolves.toEqual({
      matched: ["sdui"],
      probes: { sdui: 3, legacy: 0 },
    });
  });

  it("yields null when the probe throws", async () => {
    const client = {
      evaluate: vi.fn().mockRejectedValue(new Error("evaluate failed")),
      send: vi.fn(),
    } as unknown as CDPClient;

    // A probe that throws must not replace the caller's real failure with an
    // unrelated evaluate error, and must not skip the capture that follows.
    await expect(probeVariantDetection(client, ADAPTERS)).resolves.toBeNull();
  });

  it("yields null when the probe result is malformed", async () => {
    // Same non-evidence as a throw: the instrument did not run usefully, so
    // reporting "no adapter matched" would blame LinkedIn for our own break.
    await expect(
      probeVariantDetection(clientReturning({ nonsense: true }), ADAPTERS),
    ).resolves.toBeNull();
  });

  it("evaluates the detection source built for the given adapters", async () => {
    const client = clientReturning({ matched: [], probes: {} });

    await probeVariantDetection(client, ADAPTERS);

    expect(client.evaluate).toHaveBeenCalledWith(
      buildDetectionSource(ADAPTERS),
    );
  });
});

describe("capturePostLoadFailure — trigger and detection (#835)", () => {
  const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;

  const PROBE = {
    href: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
    title: "Post | LinkedIn",
    hasMain: true,
    hasMainFeed: true,
    mainFeedListItemCount: 1,
    mainFeedListItemsWithMenuButton: 1,
    mainFeedListItemsViableForPostScrape: 1,
    hasAuthorLink: true,
    hasAuthorLinkInMain: true,
    hasLtrSpans: true,
    hasArticles: true,
    hasReactLikeButton: false,
    hasCommentOnButton: false,
    hasTopLevelEditor: false,
    hasReactionsMenu: true,
    hasPostDetailContainer: true,
    commentElementCount: 41,
    bodyTextSnippet: "Post body text\n",
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

  async function bundleFor(
    context: Parameters<typeof capturePostLoadFailure>[1],
  ): Promise<{ bundle: Record<string, unknown>; path: string }> {
    const { writeFile } = await import("node:fs/promises");
    const writeFileMock = vi.mocked(writeFile);
    writeFileMock.mockClear();

    await capturePostLoadFailure(makeClient(), context);

    const jsonCall = writeFileMock.mock.calls.find((call) =>
      String(call[0]).endsWith(".json"),
    );
    expect(jsonCall).toBeDefined();
    return {
      bundle: JSON.parse(String(jsonCall?.[1])) as Record<string, unknown>,
      path: String(jsonCall?.[0]),
    };
  }

  it("records the per-adapter detect counts alongside the DOM probes", async () => {
    const { bundle } = await bundleFor({
      trigger: "readiness-timeout",
      detection: { matched: [], probes: { sdui: 0, legacy: 0 } },
    });

    // All-zero probes: nobody claimed the page, so the next step is
    // registering an adapter — NOT hunting a stale field selector.  No other
    // field in the bundle can say this; every other probe is a fixed
    // selector that answers a different question.
    expect(bundle).toMatchObject({
      trigger: "readiness-timeout",
      hasPostDetailContainer: true,
      variantDetection: { matched: [], probes: { sdui: 0, legacy: 0 } },
    });
  });

  it("records a null detection rather than fabricating an all-zero one", async () => {
    const { bundle } = await bundleFor({
      trigger: "readiness-timeout",
      detection: null,
    });

    // `{ sdui: 0, legacy: 0 }` would be the positive claim "no adapter
    // matched".  A probe that did not run usefully has made no claim at all,
    // and the bundle must not invent one on its behalf.
    expect(bundle.variantDetection).toBeNull();
    expect(bundle).toHaveProperty("variantDetection");
  });

  it("keeps the readiness-timeout artifact name and warn wording unchanged", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const { path } = await bundleFor({
      trigger: "readiness-timeout",
      detection: null,
    });

    // Regression pin: widening the trigger must not rename the artifact
    // operators (and ADR-007) already know.
    expect(path).toContain("wait-for-post-load-");
    expect(String(warnSpy.mock.calls[0]?.[0] ?? "")).toContain(
      "[waitForPostLoad] timeout diagnostics written:",
    );
    warnSpy.mockRestore();
  });

  it("names the extraction-failure artifact and warn line for what failed", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const { path } = await bundleFor({
      trigger: "extraction-failure",
      detection: { matched: ["sdui"], probes: { sdui: 2, legacy: 0 } },
    });

    // Not "timeout": this failure is decided in milliseconds and the
    // readiness gate went green.  A bundle labelled for a timeout that never
    // happened points the reader at a slow page that was never slow.
    expect(path).toContain("post-detail-extraction-failure-");
    expect(path).not.toContain("wait-for-post-load-");
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(message).toContain("[postDetailExtraction]");
    expect(message).toContain("extraction-failure diagnostics written:");
    // Acceptance: the warn still carries the real artifact directory.
    expect(message).toContain(path.replace(/\.json$/, ""));
    warnSpy.mockRestore();
  });

  it("stays default-off on the extraction-failure trigger too", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const client = makeClient();

    await capturePostLoadFailure(client, {
      trigger: "extraction-failure",
      detection: { matched: ["sdui"], probes: { sdui: 2 } },
    });

    // Widening the trigger must not widen the gate: the artifacts carry page
    // content, i.e. personal data, on every trigger alike.
    expect(client.evaluate).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });
});

describe("diagnosticCaptureEnabled", () => {
  const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    } else {
      process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = originalEnv;
    }
  });

  it('opens on exactly "1" and on nothing else', () => {
    // One spelling, deliberately: the artifacts carry personal data, so a
    // caller who typed `true` has not opted in.  Callers ask this rather than
    // re-spelling the comparison, so the gate has one definition.
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    expect(diagnosticCaptureEnabled()).toBe(true);

    for (const value of ["true", "yes", "0", "", "01", " 1"]) {
      process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = value;
      expect(diagnosticCaptureEnabled()).toBe(false);
    }

    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    expect(diagnosticCaptureEnabled()).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The TS→JS seam in the diagnostic probe (#875)
// ───────────────────────────────────────────────────────────────────────────
//
// The probe source is a JavaScript program inside a TypeScript template
// literal, and nothing in the type system notices when that goes wrong.  A
// hand-quoted `'${SELECTOR}'` compiles, lints, and emits either a syntax error
// or a valid-but-DIFFERENT selector.  #840 fixed seven such sites on the
// reactions-modal surface and pinned them there; the nine on THIS surface were
// deliberately left to their own item, and until it landed nothing stopped a
// tenth from being written.
//
// The consequence is worse here than at any other site, because this source
// runs only when something has ALREADY failed and the capture swallows its own
// errors: a probe that does not parse produces no json, no png and no warn
// line, at the one moment an operator is reading diagnostics.  `probe script
// collects all documented fields` above pins the probe's SHAPE; this pins that
// it is a program at all, and that the selectors reached it intact.
describe("post-detail diagnostic probe — emitted-source integrity", () => {
  const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;

  /**
   * The selectors this module INTERPOLATES into the probe — all nine.
   *
   * Every one is a module-private constant with no public accessor, so they
   * are restated here rather than exported purely to be asserted on, which
   * makes this an independent statement of what they are rather than a
   * tautology against the module's own values.
   *
   * Deliberately NOT the one-off selectors written inline in the probe
   * (`article`, `main`, the `mainFeed` / listitem / menu-button anchors):
   * those are literals in the emitted program rather than values crossing the
   * seam, so a hand-quote rule over them would fail on correct code.
   */
  const INTERPOLATED_SELECTORS = [
    'a[href*="/in/"], a[href*="/company/"]',
    'main a[href*="/in/"], main a[href*="/company/"]',
    'span[dir="ltr"]',
    'main button[aria-label^="React Like to "]',
    'main button[aria-label^="Comment on"]',
    'main [role="textbox"][aria-label^="Text editor for creating"]',
    'main button[aria-label="Open reactions menu"]',
    '[componentkey^="expanded"][componentkey$="FeedType_FEED_DETAIL"]',
    '[componentkey^="replaceableComment_"]',
  ];

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

    await capturePostLoadFailure(client, {
      trigger: "readiness-timeout",
      detection: null,
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

  it("carries every interpolated selector in its JSON string form", async () => {
    const source = await emittedProbeSource();

    // Cardinality first: an empty list would make the loop below vacuous, and
    // a green over zero selectors is not evidence that nine of them arrived.
    expect(INTERPOLATED_SELECTORS).toHaveLength(9);
    for (const selector of INTERPOLATED_SELECTORS) {
      expect(source, `missing ${selector}`).toContain(JSON.stringify(selector));
    }
  });

  it("hand-quotes none of the interpolated selectors", async () => {
    const source = await emittedProbeSource();

    // Cardinality again rather than by inheritance from the test above: this
    // one is all-negative, so an empty list would satisfy it without grading
    // anything, and deleting the test above would remove the only guard.
    expect(INTERPOLATED_SELECTORS).toHaveLength(9);
    // The form this item removed.  Asserted separately from the positive check
    // above because the two fail for different reasons: a selector could reach
    // the source in BOTH forms if a site were duplicated rather than converted.
    for (const selector of INTERPOLATED_SELECTORS) {
      expect(source, `hand-quoted ${selector}`).not.toContain(`'${selector}'`);
    }
  });

  // The two tests above iterate INTERPOLATED_SELECTORS, so they grade only the
  // sites someone remembered to list. That is precisely the failure this
  // block's header warns about — "nothing stopped a tenth from being written"
  // — and a tenth, hand-quoted, would pass every assertion above: the nine
  // listed are all still correct, and nothing counts the module's own sites.
  //
  // The check has to read the MODULE SOURCE, not the emitted source. After
  // emission a hand-quoted constant is indistinguishable from a legitimate
  // inline one-off (`'article'`, `'[data-testid="mainFeed"]'`) — both are just
  // single-quoted text in a JavaScript program. Before emission they are not:
  // one carries a `${...}` and the other does not.
  it("has no interpolation site outside the enumerated nine", () => {
    // `node:fs`, not `node:fs/promises`: this file mocks the latter for the
    // capture path, and that mock supplies no reader.
    const moduleSource = readFileSync(
      new URL("./wait-for-post-load.ts", import.meta.url),
      "utf8",
    );
    // Comments quote the forbidden form in order to forbid it, so they must be
    // dropped before the rule is applied — otherwise the file's own warning
    // against hand-quoting would fail the check that enforces it.
    const code = moduleSource
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");

    // Every value crossing the TS→JS seam goes through the helper, and there
    // are exactly as many such sites as selectors enumerated above.
    expect(code.match(/\$\{jsString\(/g) ?? []).toHaveLength(
      INTERPOLATED_SELECTORS.length,
    );
    // ...and none crosses it hand-quoted. This is the assertion that fires on
    // a tenth site the enumeration never learned about.
    expect(code).not.toMatch(/['"]\$\{/);
  });
});
