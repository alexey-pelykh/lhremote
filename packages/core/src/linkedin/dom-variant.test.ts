// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";
import {
  adaptersFor,
  asVariantDetection,
  buildDetectionSource,
  buildPostDetailExtractionSource,
  buildReadinessPredicateSource,
  formatVariantProbes,
  KNOWN_DOM_VARIANTS,
  type VariantAdapter,
  variantNamesFor,
} from "./dom-variant.js";

/**
 * Minimal stand-in for the page the generated scripts run against.
 *
 * The scripts are strings evaluated in the browser, so the unit tier cannot
 * use a real DOM.  Modelling the page as "this set of selectors matches"
 * grades exactly what these scripts decide — *which adapter claims the page*
 * — without pretending to grade field extraction, which needs a real
 * document and belongs to the fixture tier.
 */
function fakeElement(sel: string): unknown {
  // An element that exists but contains nothing.  Enough for the adapters'
  // extractors to run to completion and report empty fields, which is all
  // the unit tier claims about them.
  return {
    sel,
    textContent: "",
    href: "",
    getAttribute: () => null,
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function fakeDocument(present: readonly string[], body = ""): unknown {
  const matches = (sel: string): boolean => present.includes(sel);
  return {
    querySelector: (sel: string) => (matches(sel) ? fakeElement(sel) : null),
    querySelectorAll: (sel: string) =>
      matches(sel) ? [fakeElement(sel)] : [],
    body: { textContent: body },
  };
}

function runScript(script: string, document: unknown): unknown {
  return new Function("document", `return ${script};`)(document) as unknown;
}

/**
 * A synthetic third dialect.  Every "registering a third adapter" assertion
 * below goes through this and nothing else — no production file is edited
 * and no call site is aware of it, which is the property under test.
 */
const THIRD_ADAPTER: VariantAdapter = {
  surface: "post-detail",
  variant: "hypothetical",
  detect: '[data-hypothetical-post="1"]',
  ready: '[data-hypothetical-ready="1"]',
  scopes: ['[data-hypothetical-post="1"]'],
  extract: `(function (scope) {
    return {
      authorName: 'Third Dialect',
      authorHeadline: null,
      authorProfileUrl: null,
      text: (scope && scope.sel) || null,
      timestamp: null,
    };
  })`,
};

describe("adapter registry", () => {
  it("registers the known post-detail dialects", () => {
    expect(variantNamesFor("post-detail")).toEqual([...KNOWN_DOM_VARIANTS]);
  });

  it("has no adapter whose detect anchor is an always-true selector", () => {
    // The defect this module removes was a scope cascade ending in
    // `document.querySelector('main') || document`, both of which always
    // match.  An adapter whose *detect* anchor always matched would
    // reintroduce it one level up: it would claim every page, including
    // pages it cannot read.
    const alwaysTrue = ["main", "body", "html", ":root", "*", "document"];
    for (const adapter of adaptersFor("post-detail")) {
      expect(alwaysTrue).not.toContain(adapter.detect.trim());
      for (const scope of adapter.scopes) {
        expect(alwaysTrue).not.toContain(scope.trim());
      }
      expect(adapter.scopes.length).toBeGreaterThan(0);
    }
  });

  it("binds each adapter's ready anchor to that adapter, not to a shared one", () => {
    // ADR-008's invariant: a readiness gate must anchor on a selector
    // belonging to the same adapter that performs the extraction.  Two
    // adapters sharing one ready anchor would mean the gate cannot tell them
    // apart, which is the variant-agnostic gate the module exists to retire.
    const readyAnchors = adaptersFor("post-detail").map((a) => a.ready);
    expect(new Set(readyAnchors).size).toBe(readyAnchors.length);
  });
});

describe("selector escaping", () => {
  it("emits anchors as JSON string literals so quotes cannot break the script", () => {
    // Every real LinkedIn anchor contains double quotes
    // (`[componentkey^="expanded"]`).  Hand-quoting these into a JS string
    // either throws a syntax error or, worse, yields a valid-but-different
    // selector; JSON.stringify is the primitive that cannot.
    const script = buildReadinessPredicateSource(adaptersFor("post-detail"));
    for (const adapter of adaptersFor("post-detail")) {
      expect(script).toContain(JSON.stringify(adapter.detect));
    }
    expect(() => runScript(script, fakeDocument([]))).not.toThrow();
  });

  it("survives an adapter whose anchor contains a single quote and a backslash", () => {
    const nasty: VariantAdapter = {
      ...THIRD_ADAPTER,
      detect: `[data-x="it's"][data-y="a\\\\b"]`,
      ready: `[data-x="it's"]`,
      scopes: [`[data-x="it's"]`],
    };
    const script = buildReadinessPredicateSource([nasty]);
    expect(() => runScript(script, fakeDocument([]))).not.toThrow();
    expect(runScript(script, fakeDocument([nasty.detect, nasty.ready]))).toBe(
      true,
    );
  });
});

describe("readiness predicate", () => {
  const adapters = adaptersFor("post-detail");
  const script = buildReadinessPredicateSource(adapters);
  const [sdui, legacy] = adapters;

  it("is false when no adapter claims the page", () => {
    expect(runScript(script, fakeDocument([]))).toBe(false);
  });

  it("is false when the sole claimant's own ready anchor is absent", () => {
    expect(runScript(script, fakeDocument([sdui?.detect ?? ""]))).toBe(false);
  });

  it("is true when the sole claimant's own ready anchor is present", () => {
    expect(
      runScript(script, fakeDocument([sdui?.detect ?? "", sdui?.ready ?? ""])),
    ).toBe(true);
  });

  it("is false when two adapters claim the page, even with both ready anchors present", () => {
    // A disjunction would go green here.  Exclusivity is what makes "the
    // selected adapter" well-defined; a hybrid page is escalated, not
    // resolved by picking.
    const present = adapters.flatMap((a) => [a.detect, a.ready]);
    expect(runScript(script, fakeDocument(present))).toBe(false);
  });

  it("is not satisfied by another adapter's ready anchor", () => {
    // The precise failure the old gate had: something present on the page
    // that does not belong to the dialect being extracted.
    expect(
      runScript(
        script,
        fakeDocument([sdui?.detect ?? "", legacy?.ready ?? ""]),
      ),
    ).toBe(false);
  });
});

describe("detection probe", () => {
  const adapters = adaptersFor("post-detail");
  const script = buildDetectionSource(adapters);

  it("reports zero matches with a per-variant probe count", () => {
    const detection = asVariantDetection(runScript(script, fakeDocument([])));
    if (detection === null) throw new Error("probe result was not well-formed");
    expect(detection.matched).toEqual([]);
    // The line that is the entire diagnosis for the next flip.
    expect(formatVariantProbes(detection)).toBe("sdui: 0, legacy: 0");
  });

  it("reports every claimant when the page is ambiguous", () => {
    const detection = asVariantDetection(
      runScript(
        script,
        fakeDocument(adapters.map((a) => a.detect)),
      ),
    );
    expect(detection?.matched).toEqual([...KNOWN_DOM_VARIANTS]);
  });

  it("rejects a malformed probe result rather than reading it as zero matches", () => {
    // A broken instrument's silence is not evidence about the page: reading
    // `undefined` as "no adapter matched" would blame LinkedIn for a local
    // failure and send the operator to write an adapter that is not needed.
    expect(asVariantDetection(undefined)).toBeNull();
    expect(asVariantDetection(null)).toBeNull();
    expect(asVariantDetection(false)).toBeNull();
    expect(asVariantDetection({})).toBeNull();
    expect(asVariantDetection({ matched: "sdui" })).toBeNull();
    expect(asVariantDetection({ matched: [1, 2] })).toBeNull();
    expect(asVariantDetection({ matched: [] })).toEqual({
      matched: [],
      probes: {},
    });
  });
});

describe("post-detail extraction", () => {
  const adapters = adaptersFor("post-detail");
  const script = buildPostDetailExtractionSource(adapters);
  const [sdui, legacy] = adapters;

  it("returns null when no adapter claims the page — there is no <main> fallback", () => {
    // The headline acceptance criterion: a page nothing can read yields
    // nothing, rather than an empty record scraped out of `<main>`.
    expect(runScript(script, fakeDocument([]))).toBeNull();
  });

  it("returns null when the claiming adapter cannot resolve its own scope", () => {
    // Detect matched but no scope anchor did.  There is deliberately no
    // widening step, so this is "no usable adapter", not "empty post" — an
    // adapter that cannot find its own extraction root has not read the
    // page, and saying so is the point.
    const split: VariantAdapter = {
      ...THIRD_ADAPTER,
      scopes: ['[data-scope-that-is-absent="1"]'],
    };
    expect(
      runScript(
        buildPostDetailExtractionSource([split]),
        fakeDocument([split.detect, split.ready]),
      ),
    ).toBeNull();
  });

  it("reports the claimants when two adapters match, instead of picking one", () => {
    const result = runScript(
      script,
      fakeDocument(adapters.flatMap((a) => [a.detect, ...a.scopes])),
    ) as { ambiguousVariants?: string[] };
    expect(result.ambiguousVariants).toEqual([...KNOWN_DOM_VARIANTS]);
  });

  it("tags the record with the variant that produced it", () => {
    const result = runScript(
      buildPostDetailExtractionSource([THIRD_ADAPTER]),
      fakeDocument([THIRD_ADAPTER.detect, ...THIRD_ADAPTER.scopes]),
    ) as { variant?: string; authorName?: string };
    expect(result.variant).toBe("hypothetical");
    expect(result.authorName).toBe("Third Dialect");
  });

  it("parses engagement counts outside the adapter, from document body text", () => {
    // Dialect-independent by construction: the text-content regex was the
    // one part of the scrape that kept working across the 2026-05 rewrite,
    // so it must not be duplicated into each adapter.
    const result = runScript(
      buildPostDetailExtractionSource([THIRD_ADAPTER]),
      fakeDocument(
        [THIRD_ADAPTER.detect, ...THIRD_ADAPTER.scopes],
        "1,234 reactions 41 comments 7 reposts",
      ),
    ) as { reactionCount: number; commentCount: number; shareCount: number };
    expect(result.reactionCount).toBe(1234);
    expect(result.commentCount).toBe(41);
    expect(result.shareCount).toBe(7);
  });

  it("keeps an sdui-only page selecting sdui", () => {
    const result = runScript(
      script,
      fakeDocument([sdui?.detect ?? "", ...(sdui?.scopes ?? [])]),
    ) as { variant?: string };
    expect(result.variant).toBe("sdui");
  });

  it("selects legacy on a page serving the pre-SDUI dialect", () => {
    // The live case as of 2026-08-31: every SDUI selector matches 0 and the
    // page is readable only by the legacy adapter.  Before the registry this
    // returned an empty record with an HTTP success.
    const result = runScript(
      script,
      fakeDocument([legacy?.detect ?? "", ...(legacy?.scopes ?? [])]),
    ) as { variant?: string };
    expect(result.variant).toBe("legacy");
  });
});

describe("registering a third adapter", () => {
  // Acceptance criterion: adding a dialect is an edit to the registry array
  // and nothing else.  These assertions run the *production* generators over
  // a registry that has one extra row, and check that every behaviour the
  // call sites depend on follows from the array alone — no call site sees
  // the new variant, and no branch was added for it.
  const extended = [...adaptersFor("post-detail"), THIRD_ADAPTER];

  it("makes the readiness predicate accept the new dialect with no call-site change", () => {
    const script = buildReadinessPredicateSource(extended);
    expect(
      runScript(
        script,
        fakeDocument([THIRD_ADAPTER.detect, THIRD_ADAPTER.ready]),
      ),
    ).toBe(true);
  });

  it("makes the detection probe report the new dialect with no call-site change", () => {
    const detection = asVariantDetection(
      runScript(buildDetectionSource(extended), fakeDocument([])),
    );
    if (detection === null) throw new Error("probe result was not well-formed");
    expect(formatVariantProbes(detection)).toBe(
      "sdui: 0, legacy: 0, hypothetical: 0",
    );
  });

  it("makes extraction run the new dialect's extractors with no call-site change", () => {
    const result = runScript(
      buildPostDetailExtractionSource(extended),
      fakeDocument([THIRD_ADAPTER.detect, ...THIRD_ADAPTER.scopes]),
    ) as { variant?: string; authorName?: string };
    expect(result.variant).toBe("hypothetical");
    expect(result.authorName).toBe("Third Dialect");
  });

  it("leaves the previously-registered dialects selecting exactly as before", () => {
    // Registering a dialect must not perturb the others — otherwise "touch
    // the registry only" would be true of the file list and false of the
    // behaviour.
    const [sdui] = adaptersFor("post-detail");
    const before = runScript(
      buildPostDetailExtractionSource(adaptersFor("post-detail")),
      fakeDocument([sdui?.detect ?? "", ...(sdui?.scopes ?? [])]),
    );
    const after = runScript(
      buildPostDetailExtractionSource(extended),
      fakeDocument([sdui?.detect ?? "", ...(sdui?.scopes ?? [])]),
    );
    expect(after).toEqual(before);
  });
});
