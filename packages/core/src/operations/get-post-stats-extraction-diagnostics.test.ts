// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// Diagnostic capture on `getPostStats`'s EXTRACTION-failure path (#890).
//
// Kept out of `get-post-stats.test.ts` deliberately, following the
// `get-post-extraction-diagnostics.test.ts` precedent: that file grades
// *whether* an unreadable page raises and *which* error it raises, and these
// cases grade a different thing — whether a bundle is written on the way out.
// The two concerns want different mocks (this file has to stub
// `node:fs/promises`, which the refusal suite must not) and different
// fixtures, so splitting them keeps each readable.
//
// Why the behaviour needed adding at all: since #857 `getPostStats` evaluates
// the SAME registry-generated post-detail script `getPost` evaluates, and
// raises on the SAME two selection outcomes — but captured nothing, while
// `getPost` captured for both.  That made it the one counterexample to the
// invariant ADR-007 § 2026-09-04 Amendment (#870) states in its own
// justification, "every other place this codebase can fail to read a LinkedIn
// page wrote a bundle".
//
// The reachable population is narrow and worth stating so the coverage is not
// over-read: `waitForPostLoad` requires exactly one adapter plus its ready
// anchor, so an ordinary dialect flip times out AT THE GATE (which captures),
// and both post-detail adapters have `scopes` identical to `detect`, so
// "matched but could not resolve its own scope" is unreachable today.  What
// remains is a page that CHANGES between the readiness poll and the extraction
// `evaluate` — which is exactly what a capture is for, and exactly what no
// deadline-bound capture can see.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./navigate-away.js", () => ({
  navigateAwayIf: vi.fn().mockResolvedValue(undefined),
}));

// The capture writes real files.  Mock the fs surface so the assertions can
// read what would have landed on disk without touching it — mirrors the mock
// used by `wait-for-post-load.test.ts` and by the `getPost` sibling suite.
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}TESTABCDEF`),
  writeFile: vi.fn().mockResolvedValue(undefined),
  lstat: vi.fn().mockResolvedValue({
    isSymbolicLink: () => false,
    isDirectory: () => true,
    mode: 0o700,
  }),
  chmod: vi.fn().mockResolvedValue(undefined),
}));

import { writeFile } from "node:fs/promises";

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
} from "../services/errors.js";
import { adaptersFor } from "../linkedin/dom-variant.js";

// Dynamic import after the mocks are registered, matching the convention the
// sibling capture suites document: relying on vi.mock hoisting to cover a
// module that reaches `node:fs/promises` at load time is brittle under ESM
// transforms (`wait-for-post-load.test.ts` header).
const { getPostStats } = await import("./get-post-stats.js");

describe("getPostStats extraction-failure diagnostics (#890)", () => {
  const CDP_PORT = 9222;
  const POST_URL =
    "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/";

  const DETECTION = { matched: ["sdui"], probes: { sdui: 1, legacy: 0 } };

  const CAPTURE_PROBE = {
    href: POST_URL,
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
    commentElementCount: 41,
    bodyTextSnippet: "Hello world!\n",
    // Since #853 the registry's own anchors reach the bundle here, under each
    // dialect's name — and the probe emits one key per DECLARED selector, so a
    // hand-written `scopes: {}` is a shape the page cannot return.  Derived
    // from the registry for the same reason the probe itself is generated from
    // it: a hand-maintained copy would keep asserting against a dialect the
    // registry has since renamed or re-anchored.  Last in the object because
    // that is where the real probe puts it, so the bundle this fixture yields
    // has its keys in the real order.
    variantAnchors: Object.fromEntries(
      adaptersFor("post-detail").map((adapter, index) => [
        adapter.variant,
        {
          ready: index === 0 ? 1 : 0,
          scopes: Object.fromEntries(adapter.scopes.map((s) => [s, 1])),
          counts: Object.fromEntries(adapter.counts.map((s) => [s, 0])),
        },
      ]),
    ),
  };

  const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;

  /**
   * Drive `getPostStats` to a post-detail scrape that fails variant selection.
   *
   * The evaluate sequence walks the real call order: readiness poll, the
   * stats scrape, then — only on the failure path — the variant-detection
   * probe and the capture's own DOM probe.
   *
   * @param scrapeResult - What the extraction script resolves to: `null` for
   *   "no adapter claimed the page", or an `ambiguousVariants` record for
   *   "two or more did".
   * @param detection - What the variant-detection probe resolves to, or an
   *   `Error` to reject with (a probe that throws is non-evidence, not a
   *   verdict).
   */
  function setupVariantFailure(
    scrapeResult: unknown,
    detection: unknown = DETECTION,
  ) {
    vi.mocked(discoverTargets).mockResolvedValue([
      {
        id: "target-1",
        type: "page",
        title: "LinkedIn",
        url: "https://www.linkedin.com/feed/",
        description: "",
        devtoolsFrontendUrl: "",
      },
    ]);

    const evaluateMock = vi.fn();
    evaluateMock.mockResolvedValueOnce(true); // readiness
    evaluateMock.mockResolvedValueOnce(scrapeResult);
    if (detection instanceof Error) {
      evaluateMock.mockRejectedValueOnce(detection);
    } else {
      evaluateMock.mockResolvedValueOnce(detection);
    }
    evaluateMock.mockResolvedValueOnce(CAPTURE_PROBE);

    const disconnect = vi.fn();
    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect,
        navigate: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateMock,
        send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
      } as unknown as CDPClient;
    });

    return { evaluateMock, disconnect };
  }

  /** The JSON bundle the capture would have written, parsed. */
  function writtenBundle(): Record<string, unknown> {
    const jsonCall = vi
      .mocked(writeFile)
      .mock.calls.find((call) => String(call[0]).endsWith(".json"));
    expect(jsonCall).toBeDefined();
    return JSON.parse(String(jsonCall?.[1])) as Record<string, unknown>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv === undefined) {
      delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    } else {
      process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = originalEnv;
    }
  });

  it("captures when no adapter claims the page, and still raises unsupported", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupVariantFailure(null);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    // The propagated error must still be the refusal contract's, not one
    // manufactured by the capture machinery — a bare `.toThrow()` would pass
    // either way.
    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(DOMVariantUnsupportedError);

    expect(writtenBundle()).toMatchObject({ trigger: "extraction-failure" });
    warnSpy.mockRestore();
  });

  it("captures when two adapters claim the page, and still raises ambiguous", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupVariantFailure({ ambiguousVariants: ["sdui", "legacy"] });
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(DOMVariantAmbiguousError);

    expect(writtenBundle()).toMatchObject({ trigger: "extraction-failure" });
    warnSpy.mockRestore();
  });

  it("captures when the page evaluation yields nothing at all", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    // `CDPClient.evaluate` ends `return result.result?.value as T`, so it
    // resolves `undefined` — not `null` — whenever CDP omits `result`.  The
    // capture hangs off the same falsiness test as the refusal, so pinning it
    // here keeps the two from being tightened apart: a later `raw === null`
    // would leave this branch raising with no artifact.
    setupVariantFailure(undefined);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(DOMVariantUnsupportedError);

    expect(writtenBundle()).toMatchObject({ trigger: "extraction-failure" });
    warnSpy.mockRestore();
  });

  it("names the artifact for the failure that actually happened", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupVariantFailure(null);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(DOMVariantUnsupportedError);

    const paths = vi.mocked(writeFile).mock.calls.map((call) => String(call[0]));
    expect(paths.some((path) => path.endsWith(".json"))).toBe(true);
    // A bundle stamped `wait-for-post-load` here would send the next reader
    // hunting a slow page that was never slow — the readiness gate went green.
    expect(
      paths.every((path) => path.includes("post-detail-extraction-failure-")),
    ).toBe(true);
    expect(paths.some((path) => path.includes("wait-for-post-load-"))).toBe(
      false,
    );
    warnSpy.mockRestore();
  });

  it("records the per-adapter detection probes in the bundle", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupVariantFailure(null);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(DOMVariantUnsupportedError);

    // The field the fixed-selector probes structurally cannot supply: a
    // non-zero probe beside a `null` scrape says our adapter DID claim the
    // page between the poll and the read, so the diagnosis is "it changed
    // underneath us", not "LinkedIn served a dialect we don't know".
    expect(writtenBundle()).toMatchObject({
      trigger: "extraction-failure",
      variantDetection: { matched: ["sdui"], probes: { sdui: 1, legacy: 0 } },
      // One fixed-selector probe alongside the registry-derived field, so the
      // assertion fails if the bundle stops carrying the page reading at all.
      // `trigger` and `variantDetection` are assembled around that reading
      // rather than out of it, so both survive its loss.
      href: POST_URL,
      hasMain: true,
    });
    warnSpy.mockRestore();
  });

  it("records a null detection when the probe yields no usable reading", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupVariantFailure(null, new Error("evaluate failed"));
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(DOMVariantUnsupportedError);

    // `null`, not an all-zero probe map: a broken instrument says nothing
    // about the page, and an all-zero map would read as the positive claim
    // "no adapter matched" — the exact misdiagnosis this records against.
    expect(writtenBundle().variantDetection).toBeNull();
    warnSpy.mockRestore();
  });

  it("reports the real artifact path on the warn line", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupVariantFailure(null);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(DOMVariantUnsupportedError);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    // The per-invocation mkdtemp directory is the ONLY place these artifacts
    // live, so a warn line that does not carry the actual path leaves the
    // operator unable to find them at all.
    const writtenJsonPath = String(
      vi
        .mocked(writeFile)
        .mock.calls.find((call) => String(call[0]).endsWith(".json"))?.[0] ?? "",
    );
    expect(writtenJsonPath).not.toBe("");
    expect(message).toContain(writtenJsonPath.replace(/\.json$/, ""));
    expect(message).toContain("extraction-failure diagnostics");
    warnSpy.mockRestore();
  });

  it("is default-off: writes nothing and spends no probe when the env var is unset", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const { evaluateMock } = setupVariantFailure(null);

    // Still refuses — the empty-vs-error contract (ADR-008) is independent of
    // whether diagnostics are being collected.
    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(DOMVariantUnsupportedError);

    // Two evaluates and no more: readiness, then the scrape.  The detect
    // probe's only consumer is the bundle, so a default-off CLI or MCP run
    // must not spend a round-trip in the page producing it for nobody — and
    // the capture's own gate fires too late to prevent that, since the probe
    // would already have been evaluated as its argument.
    expect(evaluateMock).toHaveBeenCalledTimes(2);
    // The bundle contains page content, i.e. personal data.  CLI and MCP
    // callers must never write it silently.
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });

  it("does not probe or capture when the scrape succeeds", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    // Guards against the capture degenerating into fire-on-every-read, which
    // would spray personal data into tmp on the happy path.
    vi.mocked(discoverTargets).mockResolvedValue([
      {
        id: "target-1",
        type: "page",
        title: "LinkedIn",
        url: "https://www.linkedin.com/feed/",
        description: "",
        devtoolsFrontendUrl: "",
      },
    ]);
    const evaluateMock = vi.fn();
    evaluateMock.mockResolvedValueOnce(true); // readiness
    evaluateMock.mockResolvedValueOnce({
      reactionCount: 42,
      commentCount: 5,
      shareCount: 3,
    });
    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        navigate: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateMock,
        send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
      } as unknown as CDPClient;
    });

    const result = await getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(result.stats.commentCount).toBe(5);
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
    // Two evaluates and no more: the detection probe and the capture probe are
    // on the failure path only, so the happy path pays nothing for them.
    expect(evaluateMock).toHaveBeenCalledTimes(2);
  });

  it("keeps propagating the caller's error when the capture itself fails", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupVariantFailure({ ambiguousVariants: ["sdui", "legacy"] });
    const { writeFile: wf } = await import("node:fs/promises");
    vi.mocked(wf).mockRejectedValueOnce(new Error("disk full"));

    // A capture-side failure must never replace the diagnosis it was written
    // to explain.
    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(DOMVariantAmbiguousError);

    // Without this the case is vacuous: on a build that never captures at all
    // the queued rejection is never consumed, nothing throws on the way out,
    // and the assertion above passes while attesting to nothing.
    expect(vi.mocked(writeFile)).toHaveBeenCalled();
  });

  it("captures before the client disconnects", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const { disconnect } = setupVariantFailure(null);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    let disconnectedBeforeWrite = false;
    vi.mocked(writeFile).mockImplementation(async () => {
      if (disconnect.mock.calls.length > 0) disconnectedBeforeWrite = true;
    });

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(DOMVariantUnsupportedError);

    // Ordering is the whole reason the capture sits before the `throw` rather
    // than in a wrapper around the call: past it the `finally` disconnects and
    // the DOM that would have explained the failure is gone.
    //
    // Asserting a write HAPPENED first is what makes the ordering claim
    // falsifiable: with no capture at all `disconnectedBeforeWrite` stays
    // `false` vacuously, and the test would pass while proving nothing.
    expect(vi.mocked(writeFile)).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    expect(disconnectedBeforeWrite).toBe(false);
    warnSpy.mockRestore();
  });
});
