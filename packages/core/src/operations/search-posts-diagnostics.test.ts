// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// Diagnostic capture at the search-results READINESS and EXTRACTION failure
// sites (#870).
//
// Kept out of `search-posts.test.ts` deliberately, following the
// `{module}-{concern}.test.ts` precedent its post-detail and reactions-modal
// siblings already set: that file grades the readiness classification and the
// empty-vs-error contract, and these cases grade a different thing — not
// *whether* a failure raises, which that file owns, but whether a bundle is
// written on the way out.
//
// Why the behaviour needs pinning at all: this is the surface with the least
// offline evidence behind it.  Its `legacy` adapter is reconstructed rather
// than probed, so a live capture is the only way a field failure yields a page
// to read.  ADR-008 § 2026-09-02 Amendment (#841 — that date carries two, and
// this is the search-results one) records that a zero `detect` match
// here has TWO readings — LinkedIn changed its markup, or the search
// legitimately matched nothing — that the DOM cannot tell apart with what is
// measured today.  A captured artifact settles which one occurred.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("./navigate-away.js", () => ({
  navigateAwayIf: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
  gaussianBetween: vi.fn().mockReturnValue(800),
  maybeHesitate: vi.fn().mockResolvedValue(undefined),
  maybeBreak: vi.fn().mockResolvedValue(undefined),
  simulateReadingTime: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./wait-for-logged-in-state.js", () => ({
  gateOnLoggedInState: vi.fn().mockResolvedValue(undefined),
  waitForLoggedInState: vi.fn().mockResolvedValue(undefined),
  LoggedInStateTimeoutError: class extends Error {},
}));

// The capture writes real files.  Mock the fs surface so the assertions can
// read what would have landed on disk without touching it — mirrors the mock
// used by the post-detail and reactions-modal capture suites.
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

import { lstat, mkdtemp, writeFile } from "node:fs/promises";
// Real, unmocked: the assertions about where artifacts land must use the same
// platform-correct path semantics the capture composed them with.
import { dirname } from "node:path";

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import type { RawDomPost } from "./get-feed.js";
import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
  ExtractionFailedError,
  ExtractionTimeoutError,
} from "../services/errors.js";

// Dynamic import after the mocks are registered, matching the convention the
// sibling capture suites document: relying on vi.mock hoisting to cover a
// module that reaches `node:fs/promises` at load time is brittle under ESM
// transforms.
const {
  captureSearchResultsFailure,
  SEARCH_RESULTS_CAPTURE_PROBE_SCRIPT,
  searchPosts,
  waitForSearchResults,
} = await import("./search-posts.js");

const { buildSearchResultsCardFunnelSource, adaptersFor } = await import(
  "../linkedin/dom-variant.js"
);

const CDP_PORT = 9222;

/**
 * Markers that tell the four generated scripts apart in the evaluate mock.
 *
 * The funnel marker is checked first: it is the one script whose identity
 * matters most to these tests, and checking it ahead of the others removes any
 * question of a future generator emitting an aliasing substring.
 */
const FUNNEL_MARKER = "__lhSearchResultCardFunnel";
const EXTRACTION_MARKER = "postCardCount";
const READINESS_MARKER = "selection.adapter.ready";
const DETECTION_MARKER = "probes[a.variant]";

/** One successful scrape, as the generated extraction script reports it. */
interface SearchScrape {
  variant: string;
  postCardCount: number;
  posts: RawDomPost[];
}

/**
 * The funnel probe reading for a page that rendered six post-shaped cards
 * none of which carried a control menu.
 *
 * This IS the corroboration failure's fingerprint, and the reason the funnel
 * counts are cumulative: every card filter is shared with the cardinal except
 * the control-menu one, so `cardsWithAuthorLink: 6` beside
 * `cardsWithMenuButton: 0` names the stale selector outright.
 */
const CARDS_WITHOUT_MENU_PROBE = {
  href: "https://www.linkedin.com/search/results/content/?keywords=test",
  title: "test | Search | LinkedIn",
  hasMain: true,
  // Zero document-wide is the measured legacy-reversion fingerprint
  // (2026-08-31), not merely one stale selector.
  dataTestIdCount: 0,
  bodyTextSnippet: "Posts\nAlice Smith\nHello world\n",
  scopeMatchCounts: {
    'div[role="listitem"]': 6,
    "[data-chameleon-result-urn]": 6,
  },
  candidateCardCount: 6,
  cardsClearingHeightFloor: 6,
  cardsWithAuthorLink: 6,
  cardsWithMenuButton: 0,
};

/**
 * The funnel probe reading for a page with no result cards at all.
 *
 * The ambiguous case this surface exists to disambiguate: identical funnel
 * counts arise from a dialect flip and from a search that matched nothing, and
 * only `bodyTextSnippet` (and the screenshot beside it) tells them apart.
 */
const NO_CARDS_PROBE = {
  ...CARDS_WITHOUT_MENU_PROBE,
  bodyTextSnippet: "No results found\nTry different keywords\n",
  scopeMatchCounts: {
    'div[role="listitem"]': 0,
    "[data-chameleon-result-urn]": 0,
  },
  candidateCardCount: 0,
  cardsClearingHeightFloor: 0,
  cardsWithAuthorLink: 0,
  cardsWithMenuButton: 0,
};

const ZERO_MATCH_DETECTION = { matched: [], probes: { sdui: 0, legacy: 0 } };

/** A client that answers `evaluate` and `send`, and nothing else. */
function fakeClient(
  evaluate: (script: string) => Promise<unknown>,
): CDPClient {
  return {
    evaluate,
    send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
  } as unknown as CDPClient;
}

/**
 * A client driven to the readiness deadline.
 *
 * @param detection - What the classification probe resolves to, or an `Error`
 *   to reject with (a probe that throws is non-evidence, not a verdict).
 * @param probe     - What the capture's own funnel probe resolves to.
 */
function timingOutClient(
  detection: unknown = ZERO_MATCH_DETECTION,
  probe: unknown = NO_CARDS_PROBE,
): CDPClient {
  return fakeClient((script) => {
    const s = String(script);
    if (s.includes(FUNNEL_MARKER)) return Promise.resolve(probe);
    if (s.includes(READINESS_MARKER)) return Promise.resolve(false);
    if (s.includes(DETECTION_MARKER)) {
      return detection instanceof Error
        ? Promise.reject(detection)
        : Promise.resolve(detection);
    }
    return Promise.resolve(null);
  });
}

/** Wire `searchPosts` up to a scrape and a capture-probe reading. */
function setupOperationMocks(
  scraped: SearchScrape | { ambiguousVariants: string[] } | null,
  {
    detection = { matched: ["legacy"], probes: { sdui: 0, legacy: 6 } },
    probe = CARDS_WITHOUT_MENU_PROBE,
  }: { detection?: unknown; probe?: unknown } = {},
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

  const evaluate = vi.fn().mockImplementation((script: string) => {
    const s = String(script);
    if (s.includes(FUNNEL_MARKER)) return Promise.resolve(probe);
    if (s.includes(EXTRACTION_MARKER)) return Promise.resolve(scraped);
    if (s.includes(READINESS_MARKER)) return Promise.resolve(true);
    if (s.includes(DETECTION_MARKER)) {
      return detection instanceof Error
        ? Promise.reject(detection)
        : Promise.resolve(detection);
    }
    return Promise.resolve(null);
  });

  vi.mocked(CDPClient).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      navigate: vi.fn().mockResolvedValue({ frameId: "F1" }),
      evaluate,
      send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
    } as unknown as CDPClient;
  });

  return { evaluate };
}

/** Paths the capture would have written. */
function writtenPaths(): string[] {
  return vi.mocked(writeFile).mock.calls.map((call) => String(call[0]));
}

/** The JSON bundle the capture would have written, parsed. */
function writtenBundle(): Record<string, unknown> {
  const jsonCall = vi
    .mocked(writeFile)
    .mock.calls.find((call) => String(call[0]).endsWith(".json"));
  expect(jsonCall).toBeDefined();
  return JSON.parse(String(jsonCall?.[1])) as Record<string, unknown>;
}

const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;

/** Silence — and capture — the trailing warn line the helper emits. */
function silenceWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
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

describe("waitForSearchResults readiness-timeout diagnostics (#870)", () => {
  it("canary: the readiness predicate is recognized, not merely un-matched", async () => {
    // `timingOutClient`'s fallback resolves `null`, which the polling loop
    // reads as falsy exactly like the `false` the predicate returns — so if
    // the generator ever stopped emitting `selection.adapter.ready`, every
    // readiness case below would stay green while recognizing nothing.  The
    // other three markers self-canary through their own assertions; this one
    // cannot, so it is pinned here.
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const warnSpy = silenceWarn();
    const seen: string[] = [];
    const client = fakeClient((script) => {
      seen.push(String(script));
      const s = String(script);
      if (s.includes(FUNNEL_MARKER)) return Promise.resolve(NO_CARDS_PROBE);
      if (s.includes(READINESS_MARKER)) return Promise.resolve(false);
      if (s.includes(DETECTION_MARKER)) {
        return Promise.resolve(ZERO_MATCH_DETECTION);
      }
      return Promise.resolve(null);
    });

    await expect(waitForSearchResults(client, 1)).rejects.toThrow();

    expect(
      seen.some((script) => script.includes(READINESS_MARKER)),
    ).toBe(true);
    expect(seen.some((script) => script.includes(DETECTION_MARKER))).toBe(true);
    warnSpy.mockRestore();
  });

  it("writes a bundle named for the readiness timeout", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const warnSpy = silenceWarn();

    // The propagated error must still be the readiness classification's, not
    // one manufactured by the capture machinery — a bare `.toThrow()` would
    // pass either way.
    await expect(
      waitForSearchResults(timingOutClient(), 1),
    ).rejects.toBeInstanceOf(DOMVariantUnsupportedError);

    const paths = writtenPaths();
    expect(paths.some((path) => path.endsWith(".json"))).toBe(true);
    expect(
      paths.every((path) => path.includes("wait-for-search-results-")),
    ).toBe(true);
    warnSpy.mockRestore();
  });

  it("records the per-adapter detection probes and the card funnel", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const warnSpy = silenceWarn();

    await expect(waitForSearchResults(timingOutClient(), 1)).rejects.toThrow();

    expect(writtenBundle()).toMatchObject({
      trigger: "readiness-timeout",
      // The field the fixed probes structurally cannot supply.  Here it is
      // also the field the whole item turns on: all-zero probes on THIS
      // surface mean an unknown dialect OR an empty result set, and nothing
      // in the funnel can separate those two.
      variantDetection: ZERO_MATCH_DETECTION,
      candidateCardCount: 0,
      // What a reader actually separates them with.  Deliberately not a
      // `hasNoResultsBlock` probe: no such anchor has been measured on either
      // dialect, and a confident wrong reading in the one artifact an
      // operator has left is worse than none.
      bodyTextSnippet: "No results found\nTry different keywords\n",
    });
    warnSpy.mockRestore();
  });

  it("records a null cardinals block — no scrape ran at this site", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const warnSpy = silenceWarn();

    await expect(waitForSearchResults(timingOutClient(), 1)).rejects.toThrow();

    // Present and `null`, not absent.  `trigger` says which case it is: a
    // readiness timeout never got as far as a scrape, so there is nothing to
    // record — and an omitted key would be indistinguishable from a capture
    // that dropped the field.
    const bundle = writtenBundle();
    expect(bundle).toHaveProperty("cardinals");
    expect(bundle.cardinals).toBeNull();
    warnSpy.mockRestore();
  });

  it("records a null detection when the probe yields no usable reading", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const warnSpy = silenceWarn();

    // A probe that throws says the instrument did not run usefully; the gate
    // falls back to the plain timeout rather than blaming LinkedIn.
    await expect(
      waitForSearchResults(timingOutClient(new Error("evaluate failed")), 1),
    ).rejects.toBeInstanceOf(ExtractionTimeoutError);

    // `null`, not an all-zero probe map: a broken instrument says nothing
    // about the page, and an all-zero map would read as the positive claim
    // "no adapter matched" — which on THIS surface additionally reads as "the
    // search found nothing", so the misdiagnosis compounds.
    expect(writtenBundle().variantDetection).toBeNull();
    warnSpy.mockRestore();
  });

  it("captures on the ambiguous branch too", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const warnSpy = silenceWarn();

    const client = timingOutClient({
      matched: ["sdui", "legacy"],
      probes: { sdui: 6, legacy: 6 },
    });
    await expect(waitForSearchResults(client, 1)).rejects.toBeInstanceOf(
      DOMVariantAmbiguousError,
    );

    // All three classified outcomes want the same artifact, which is why the
    // capture fires ahead of the classification rather than per-branch.
    expect(writtenBundle()).toMatchObject({
      trigger: "readiness-timeout",
      variantDetection: { matched: ["sdui", "legacy"] },
    });
    warnSpy.mockRestore();
  });

  it("captures on the plain-timeout branch too", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const warnSpy = silenceWarn();

    const client = timingOutClient({
      matched: ["legacy"],
      probes: { sdui: 0, legacy: 6 },
    });
    await expect(waitForSearchResults(client, 1)).rejects.toBeInstanceOf(
      ExtractionTimeoutError,
    );

    expect(writtenBundle()).toMatchObject({
      variantDetection: { matched: ["legacy"] },
    });
    warnSpy.mockRestore();
  });

  it("reports the real artifact path on the warn line", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const warnSpy = silenceWarn();

    await expect(waitForSearchResults(timingOutClient(), 1)).rejects.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    // The per-invocation mkdtemp directory is the ONLY place these artifacts
    // live, so a warn line that does not carry the actual path leaves the
    // operator unable to find them at all.
    const writtenJsonPath =
      writtenPaths().find((path) => path.endsWith(".json")) ?? "";
    expect(writtenJsonPath).not.toBe("");
    expect(message).toContain(writtenJsonPath.replace(/\.json$/, ""));
    expect(message).toContain("[waitForSearchResults]");
    expect(message).toContain("timeout diagnostics");
    warnSpy.mockRestore();
  });

  it("is default-off: writes nothing when LHREMOTE_CAPTURE_DIAGNOSTICS is unset", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;

    // Still raises — the readiness contract is independent of whether
    // diagnostics are being collected.
    await expect(
      waitForSearchResults(timingOutClient(), 1),
    ).rejects.toBeInstanceOf(DOMVariantUnsupportedError);

    // The bundle contains page content, i.e. personal data.  CLI and MCP
    // callers must never write it silently.
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });
});

describe("captureSearchResultsFailure itself — the wrapper properties", () => {
  // The capture entry point, driven DIRECTLY rather than through an operation.
  // Both sibling surfaces test their wrapper this way, and it is the only
  // route to the properties below: a caller-level test cannot distinguish
  // "the capture swallowed its failure" from "the capture succeeded", which
  // is exactly the distinction that matters here.

  const CONTEXT = {
    trigger: "readiness-timeout",
    detection: ZERO_MATCH_DETECTION,
    cardinals: null,
  } as const;

  it("swallows its own failure — a capture-side error never reaches the caller", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("disk full"));

    // The whole point of the `.catch` + outer `try`: both call sites `await`
    // this INSIDE a path that is about to raise the real failure, and one of
    // them re-throws from a `catch`.  A capture that rejected would replace
    // an `ExtractionFailedError` naming a stale selector with a disk error —
    // destroying the very diagnosis this feature exists to produce.
    await expect(
      captureSearchResultsFailure(
        fakeClient(() => Promise.resolve(NO_CARDS_PROBE)),
        CONTEXT,
      ),
    ).resolves.toBeUndefined();
  });

  it("swallows a probe that throws, and writes nothing", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";

    await expect(
      captureSearchResultsFailure(
        fakeClient(() => Promise.reject(new Error("evaluate failed"))),
        CONTEXT,
      ),
    ).resolves.toBeUndefined();
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });

  it("refuses to write when the diagnostics directory is not owner-only", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    // `ensureSecureDiagnosticDir` re-lstats the freshly-created directory and
    // refuses on a symlink.  Personal data must not be written into a path
    // another local user controls, so a refusal means NOTHING is written —
    // not a bundle with a warning.
    vi.mocked(lstat).mockResolvedValueOnce({
      isSymbolicLink: () => true,
      isDirectory: () => false,
      mode: 0o700,
    } as unknown as Awaited<ReturnType<typeof lstat>>);
    const warnSpy = silenceWarn();

    await captureSearchResultsFailure(
      fakeClient(() => Promise.resolve(NO_CARDS_PROBE)),
      CONTEXT,
    );

    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("writes the bundle owner-only, into the directory mkdtemp just created", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const warnSpy = silenceWarn();

    await captureSearchResultsFailure(
      fakeClient(() => Promise.resolve(NO_CARDS_PROBE)),
      CONTEXT,
    );

    // 0o600 on a file holding third parties' names, headlines and post bodies
    // in a shared `os.tmpdir()`.  Dropping the options object while adding a
    // field would leave it world-readable and nothing else would notice.
    const jsonCall = vi
      .mocked(writeFile)
      .mock.calls.find((call) => String(call[0]).endsWith(".json"));
    expect(jsonCall?.[2]).toMatchObject({ mode: 0o600 });
    const pngCall = vi
      .mocked(writeFile)
      .mock.calls.find((call) => String(call[0]).endsWith(".png"));
    expect(pngCall?.[2]).toMatchObject({ mode: 0o600 });

    // No shared parent: the directory holding the bundle IS the one mkdtemp
    // just made, which is what closes the TOCTOU window (ADR-007
    // § 2026-05-05 Amendment).
    //
    // Asserted through `path.dirname` rather than by splitting on a literal
    // "/": the paths under test come out of `path.join`, so on Windows they
    // carry `\` and a POSIX-separator split would return the whole path and
    // compare it against itself-with-a-prefix.  `node:path` is deliberately
    // NOT mocked here, so this is the same platform-correct implementation
    // the capture itself composed the path with.
    const baseDir = String(
      await vi.mocked(mkdtemp).mock.results[0]?.value ?? "",
    );
    expect(baseDir).not.toBe("");
    expect(dirname(String(jsonCall?.[0]))).toBe(baseDir);
    expect(dirname(String(pngCall?.[0]))).toBe(baseDir);
    warnSpy.mockRestore();
  });

  it("reports json only, and no png, when the screenshot fails", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const warnSpy = silenceWarn();
    const client = {
      evaluate: () => Promise.resolve(NO_CARDS_PROBE),
      send: vi.fn().mockRejectedValue(new Error("screenshot unavailable")),
    } as unknown as CDPClient;

    await captureSearchResultsFailure(client, CONTEXT);

    // The screenshot is best-effort and a page that just failed to render is
    // exactly where it is most likely to fail.  A warn line promising a
    // `.png` that was never written sends the operator hunting a file that
    // does not exist, inside a randomized directory.
    const paths = writtenPaths();
    expect(paths.some((path) => path.endsWith(".json"))).toBe(true);
    expect(paths.some((path) => path.endsWith(".png"))).toBe(false);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(message).toMatch(/\.json$/);
    expect(message).not.toContain("{json,png}");
    warnSpy.mockRestore();
  });

  it("evaluates the registry-generated funnel source verbatim", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const warnSpy = silenceWarn();
    const seen: string[] = [];

    await captureSearchResultsFailure(
      fakeClient((script) => {
        seen.push(String(script));
        return Promise.resolve(NO_CARDS_PROBE);
      }),
      CONTEXT,
    );

    // BYTE-IDENTICAL to what the generator emits, not merely "contains the
    // marker".  The funnel is generated precisely so it cannot drift from the
    // card loop it mirrors; a hand-inlined copy at this site would satisfy
    // every other test in this file while measuring a layer the loop no
    // longer applies — a diagnostic that lies.
    const generated = buildSearchResultsCardFunnelSource(
      adaptersFor("search-results"),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(generated);
    // And the probe the operation sends is the exported constant the Tier-2
    // oracle evaluates in a real browser — not a lookalike rebuilt here.
    expect(seen[0]).toBe(SEARCH_RESULTS_CAPTURE_PROBE_SCRIPT);
    warnSpy.mockRestore();
  });

  it("is default-off even when called directly", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const evaluate = vi.fn().mockResolvedValue(NO_CARDS_PROBE);

    await captureSearchResultsFailure(fakeClient(evaluate), CONTEXT);

    // The gate is the security boundary, not the callers' politeness: no
    // directory, no probe evaluated in the page, no write.
    expect(vi.mocked(mkdtemp)).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });
});

describe("searchPosts extraction-failure diagnostics (#870)", () => {
  /** A settled scrape whose cardinal contradicts its own empty result. */
  const CONTRADICTED: SearchScrape = {
    variant: "legacy",
    postCardCount: 6,
    posts: [],
  };

  it("writes a bundle named for the extraction failure, not the timeout", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupOperationMocks(CONTRADICTED);
    const warnSpy = silenceWarn();

    await expect(
      searchPosts({ query: "test", cdpPort: CDP_PORT }),
    ).rejects.toBeInstanceOf(ExtractionFailedError);

    const paths = writtenPaths();
    expect(paths.some((path) => path.endsWith(".json"))).toBe(true);
    // Named for the failure that actually happened.  A bundle stamped
    // `wait-for-search-results` here would send the next reader hunting a
    // slow page that was never slow — the readiness gate went green.
    expect(
      paths.every((path) =>
        path.includes("search-results-extraction-failure-"),
      ),
    ).toBe(true);
    expect(paths.some((path) => path.includes("wait-for-search-results-"))).toBe(
      false,
    );
    warnSpy.mockRestore();
  });

  it("records the cardinal pair the contradiction is made of", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupOperationMocks(CONTRADICTED);
    const warnSpy = silenceWarn();

    await expect(
      searchPosts({ query: "test", cdpPort: CDP_PORT }),
    ).rejects.toThrow();

    // What makes an ExtractionFailedError on this surface self-explaining: the
    // error prints `postCardCount=6`, and the bundle prints it beside the
    // extraction it contradicts and the dialect that produced both, so a
    // reader never reconstructs the comparison from a scrape they cannot see.
    expect(writtenBundle()).toMatchObject({
      trigger: "extraction-failure",
      cardinals: { variant: "legacy", postCardCount: 6, extractedCount: 0 },
    });
    warnSpy.mockRestore();
  });

  it("records the funnel layer that collapsed, and the detection beside it", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupOperationMocks(CONTRADICTED);
    const warnSpy = silenceWarn();

    await expect(
      searchPosts({ query: "test", cdpPort: CDP_PORT }),
    ).rejects.toThrow();

    // The counts are cumulative, so the step where the number collapses names
    // the broken layer: six cards were post-shaped and none carried a control
    // menu.  Read with a non-zero `legacy` probe, that is "our adapter DID
    // claim the page, so the menu-button selector went stale" — not "LinkedIn
    // served a dialect we don't know".
    expect(writtenBundle()).toMatchObject({
      cardsWithAuthorLink: 6,
      cardsWithMenuButton: 0,
      variantDetection: { matched: ["legacy"], probes: { sdui: 0, legacy: 6 } },
    });
    warnSpy.mockRestore();
  });

  it("reports the extraction-failure tag on the warn line", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupOperationMocks(CONTRADICTED);
    const warnSpy = silenceWarn();

    await expect(
      searchPosts({ query: "test", cdpPort: CDP_PORT }),
    ).rejects.toThrow();

    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    // Deliberately NOT `[waitForSearchResults]`: that gate went green, and
    // labelling this line with it would point the reader at a slow page.
    expect(message).toContain("[searchResultsExtraction]");
    expect(message).toContain("extraction-failure diagnostics");
    warnSpy.mockRestore();
  });

  it("captures at the container tier when no adapter reads the settled page", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    // Readiness went green — exactly one adapter's detect anchor matched a
    // card moments ago — and the scrape then came back `null`.  That is the
    // failure the funnel diagnoses best, and it never reaches a deadline, so
    // the readiness gate's own capture cannot see it.
    setupOperationMocks(null);
    const warnSpy = silenceWarn();

    await expect(
      searchPosts({ query: "test", cdpPort: CDP_PORT }),
    ).rejects.toBeInstanceOf(DOMVariantUnsupportedError);

    expect(writtenBundle()).toMatchObject({
      trigger: "extraction-failure",
      // No scrape settled, so there is no cardinal pair — distinguished from
      // the readiness case by `trigger`, which is why the field is always
      // present rather than sometimes absent.
      cardinals: null,
    });
    warnSpy.mockRestore();
  });

  it("captures at the container tier when two adapters claim the settled page", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupOperationMocks({ ambiguousVariants: ["sdui", "legacy"] });
    const warnSpy = silenceWarn();

    await expect(
      searchPosts({ query: "test", cdpPort: CDP_PORT }),
    ).rejects.toBeInstanceOf(DOMVariantAmbiguousError);

    expect(writtenBundle()).toMatchObject({
      trigger: "extraction-failure",
      cardinals: null,
    });
    warnSpy.mockRestore();
  });

  it("is default-off: writes nothing when LHREMOTE_CAPTURE_DIAGNOSTICS is unset", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const { evaluate } = setupOperationMocks(CONTRADICTED);

    // Still raises — the empty-vs-error contract is independent of whether
    // diagnostics are being collected.
    await expect(
      searchPosts({ query: "test", cdpPort: CDP_PORT }),
    ).rejects.toBeInstanceOf(ExtractionFailedError);

    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
    // And the detect probe is skipped outright: its sole consumer is the
    // bundle, so running it on a default-off CLI or MCP run would spend a
    // `Runtime.evaluate` in the page for nobody.
    const scripts = evaluate.mock.calls.map((call) => String(call[0]));
    expect(scripts.some((s) => s.includes(DETECTION_MARKER))).toBe(false);
  });

  it("does not probe or capture when a genuinely empty result set is corroborated", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    // Cardinal agrees with the empty list: a search that found nothing.
    // Guards against the capture degenerating into fire-on-every-empty, which
    // would spray personal data into tmp on a perfectly ordinary call.
    const { evaluate } = setupOperationMocks({
      variant: "sdui",
      postCardCount: 0,
      posts: [],
    });

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT });

    expect(result.posts).toEqual([]);
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
    const scripts = evaluate.mock.calls.map((call) => String(call[0]));
    expect(scripts.some((s) => s.includes(FUNNEL_MARKER))).toBe(false);
  });

  it("does not capture on the happy path", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupOperationMocks({
      variant: "sdui",
      postCardCount: 1,
      posts: [
        {
          url: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
          authorName: "Alice Smith",
          authorHeadline: null,
          authorProfileUrl: null,
          text: "Hello world",
          mediaType: null,
          reactionCount: 0,
          commentCount: 0,
          shareCount: 0,
          timestamp: null,
        },
      ],
    });

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT });

    expect(result.posts).toHaveLength(1);
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });
});
