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

/**
 * Match a selector against the set of selectors the page is pretending to
 * have.  Selector LISTS are split, because `querySelector('a, b')` matches
 * when EITHER side matches and several adapter anchors are lists — a double
 * that compared the whole string would report "absent" for a page that a
 * real browser matches, which is a false pass in the safe-looking direction.
 *
 * Splitting on a bare comma is sound for the anchors in play (none contains a
 * comma inside brackets or quotes); the real-browser tier is what grades CSS
 * semantics properly.
 */
function selectorMatches(present: readonly string[], sel: string): boolean {
  const wanted = new Set(present.flatMap((p) => p.split(",").map((s) => s.trim())));
  return sel.split(",").some((part) => wanted.has(part.trim()));
}

/**
 * An element spec — the shape of one node in a hand-built stand-in tree.
 *
 * `fakeElement` above is enough to grade *selection*, which is all the scripts
 * decided before the engagement counts and the author fields were bound to the
 * DOM.  Both of those reads turn on the relationship between an element and
 * its descendants — which copy of a doubled string a wrapper holds, which
 * element of a counts row renders which counter — so grading them needs a tree
 * whose `textContent` concatenates its children exactly as a browser's does.
 * That concatenation IS the defect under test.
 */
interface ElementSpec {
  /** Selector list this element answers to, as a real one would. */
  readonly sel?: string;
  /** `aria-label`, where the element carries one. */
  readonly label?: string;
  /** `href`, where the element is an anchor. */
  readonly href?: string;
  /** This element's own text.  Leaves only, as in real markup. */
  readonly text?: string;
  readonly children?: readonly ElementSpec[];
}

interface FakeEl {
  readonly textContent: string;
  readonly href: string;
  /** Every descendant in document order.  Node identity is stable, which is
   *  what makes `contains` an ancestry test rather than a value comparison. */
  readonly descendants: FakeEl[];
  getAttribute(name: string): string | null;
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
  closest(sel: string): FakeEl | null;
  contains(other: FakeEl): boolean;
  /** Whether this element answers to `sel`; `*` answers to everything. */
  matchesSelector(sel: string): boolean;
}

/** Every element of the tree in document order, the root first. */
function flatten(spec: ElementSpec): ElementSpec[] {
  return [spec, ...(spec.children ?? []).flatMap(flatten)];
}

/**
 * `textContent` semantics, verbatim: own text plus every descendant's, with no
 * separator of any kind.  A stand-in that inserted one would make the two
 * counters this suite is about readable, and the bug unreproducible.
 */
function specText(spec: ElementSpec): string {
  return (spec.text ?? "") + (spec.children ?? []).map(specText).join("");
}

/**
 * What a READER sees: the leaf texts separated, because the elements holding
 * them are laid out apart.  This is the only place the rendered form and the
 * concatenated one differ, and telling them apart is the whole point.
 */
function renderedText(spec: ElementSpec): string {
  return flatten(spec)
    .map((node) => node.text ?? "")
    .filter((text) => text.length > 0)
    .join(" ");
}

function buildElement(spec: ElementSpec): FakeEl {
  const children = (spec.children ?? []).map(buildElement);
  const descendants = children.flatMap((child) => [child, ...child.descendants]);
  const matchesSelf = (sel: string): boolean =>
    sel.trim() === "*" || selectorMatches([spec.sel ?? ""], sel);
  const self: FakeEl = {
    textContent: specText(spec),
    href: spec.href ?? "",
    descendants,
    getAttribute: (name: string) => {
      if (name === "aria-label") return spec.label ?? null;
      if (name === "href") return spec.href ?? null;
      return null;
    },
    querySelectorAll: (sel: string) =>
      descendants.filter((node) => node.matchesSelector(sel)),
    querySelector: (sel: string) =>
      descendants.find((node) => node.matchesSelector(sel)) ?? null,
    closest: () => null,
    contains: (other: FakeEl) => other === self || descendants.includes(other),
    matchesSelector: matchesSelf,
  };
  return self;
}

/**
 * A page.  `trees` supplies a real subtree for a selector the page should
 * answer with; every other present selector still resolves to the contentless
 * stand-in, which is all the selection assertions need.
 */
function fakeDocument(
  present: readonly string[],
  trees: Readonly<Record<string, ElementSpec>> = {},
): unknown {
  const matches = (sel: string): boolean => selectorMatches(present, sel);
  const resolve = (sel: string): unknown => {
    for (const [key, spec] of Object.entries(trees)) {
      if (selectorMatches([key], sel)) return buildElement(spec);
    }
    return matches(sel) ? fakeElement(sel) : null;
  };
  return {
    querySelector: (sel: string) => resolve(sel),
    querySelectorAll: (sel: string) => {
      const el = resolve(sel);
      return el === null ? [] : [el];
    },
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
  counts: [],
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

  it("keeps every declared scope reachable", () => {
    // A scope is only reachable if some page can select the adapter without
    // an earlier scope resolving.  With `detect` narrower than `scopes[0]`,
    // selection would guarantee `scopes[0]` resolves and every later entry
    // would be dead code — worse, dead code that the extractor's comments
    // cite as the reason live exclusions exist.  Requiring `detect` to cover
    // the whole scope list is what keeps a documented fallback real.
    for (const adapter of adaptersFor("post-detail")) {
      if (adapter.scopes.length <= 1) continue;
      for (const scope of adapter.scopes) {
        expect(adapter.detect).toContain(scope);
      }
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

describe("blast radius of a defective adapter", () => {
  // A broken extractor is the most likely defect in a new adapter, and it is
  // the one an author is least able to catch before shipping. It must not be
  // able to take down readiness for the OTHER dialects: the readiness and
  // detection scripts never carry extractor source, so an extractor that
  // cannot even parse is inert until extraction actually runs.
  const broken: VariantAdapter = {
    ...THIRD_ADAPTER,
    extract: `(function (scope) { this is not valid javascript ]]] })`,
  };
  const withBroken = [...adaptersFor("post-detail"), broken];

  it("does not break the readiness predicate for other dialects", () => {
    const script = buildReadinessPredicateSource(withBroken);
    const [sdui] = adaptersFor("post-detail");

    expect(() => runScript(script, fakeDocument([]))).not.toThrow();
    expect(
      runScript(script, fakeDocument([sdui?.detect ?? "", sdui?.ready ?? ""])),
    ).toBe(true);
  });

  it("does not break the detection probe", () => {
    const script = buildDetectionSource(withBroken);

    expect(() => runScript(script, fakeDocument([]))).not.toThrow();
    expect(asVariantDetection(runScript(script, fakeDocument([])))).not.toBeNull();
  });

  it("keeps extractor source out of the readiness and detection scripts", () => {
    const marker = "not valid javascript";
    expect(buildReadinessPredicateSource(withBroken)).not.toContain(marker);
    expect(buildDetectionSource(withBroken)).not.toContain(marker);
    // ...and the extraction script is where it legitimately appears.
    expect(buildPostDetailExtractionSource(withBroken)).toContain(marker);
  });
});

describe("readiness predicate", () => {
  const adapters = adaptersFor("post-detail");
  const script = buildReadinessPredicateSource(adapters);
  const [sdui, legacy] = adapters;

  it("accepts the sdui screen fallback when the container prefix is gone", () => {
    // The tolerance the pre-registry cascade had for the `expanded` prefix
    // being renamed: the screen wrapper is still an SDUI root, so the adapter
    // still claims the page rather than reporting it unsupported.
    const screen =
      '[data-sdui-screen="com.linkedin.sdui.flagshipnav.feed.UpdateDetail"]';
    expect(sdui?.scopes).toContain(screen);
    expect(
      runScript(
        script,
        fakeDocument([screen, `${screen} a[href*="/in/"]`]),
      ),
    ).toBe(true);
  });

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

  it("drops non-numeric probe counts instead of trusting the cast", () => {
    // The container being an object says nothing about its values.  An
    // unchecked cast would print `sdui: [object Object]` on the one line
    // that is supposed to BE the diagnosis.  `matched` is what decides the
    // error class and is validated separately, so a bad count degrades the
    // diagnostic rather than discarding the classification.
    const detection = asVariantDetection({
      matched: ["sdui"],
      probes: { sdui: 3, legacy: "many", broken: {}, nan: Number.NaN },
    });

    expect(detection).toEqual({ matched: ["sdui"], probes: { sdui: 3 } });
    if (detection === null) throw new Error("probe result was not well-formed");
    expect(formatVariantProbes(detection)).toBe("sdui: 3");
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

  it("reads no page-wide text at all", () => {
    // The counts used to come from `document.body.textContent`, which made the
    // first "<N> comments"-shaped run ANYWHERE on the page the post's comment
    // count.  Nothing about the number that came back could reveal that, so
    // the absence of the read is asserted directly rather than inferred from
    // a value.
    expect(script).not.toContain("document.body");
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

// ───────────────────────────────────────────────────────────────────────────
// Engagement counts and author identity (#836)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The engagement-counts row exactly as it rendered live on 2026-08-31, on the
 * probe run that found LinkedIn serving the legacy dialect (#836).
 *
 * Two counters side by side.  The comment count renders its own words; the
 * reaction count renders as a BARE NUMBER, with the words only in the
 * control's `aria-label` — which is why a text-only read returned
 * `reactionCount: 0` for a post carrying two reactions.
 */
const LIVE_COUNTS_ROW: ElementSpec = {
  sel: ".social-details-social-counts",
  children: [
    {
      sel: "ul",
      children: [
        {
          sel: "li",
          children: [
            {
              sel: "button",
              label: "2 reactions",
              children: [{ sel: "span", text: "2" }],
            },
          ],
        },
        {
          sel: "li",
          children: [{ sel: "button", label: "41 comments", text: "41 comments" }],
        },
      ],
    },
  ],
};

/** The actor block, so a counts fixture still produces a complete record. */
const LEGACY_AUTHOR_ANCHOR: ElementSpec = {
  sel: 'a[href*="/in/"]',
  href: "https://www.linkedin.com/in/alexey-pelykh/",
  children: [{ sel: 'span, [aria-hidden="true"]', text: "Alexey Pelykh" }],
};

/**
 * A legacy page whose update container holds exactly `children`, in order.
 *
 * Order is load-bearing for the counts reads below: it decides which
 * containment chain an un-narrowed read would start from.
 */
function legacyPage(children: readonly ElementSpec[]): unknown {
  const legacy = adaptersFor("post-detail").find((a) => a.variant === "legacy");
  const container = legacy?.scopes[0] ?? "";
  return fakeDocument([legacy?.detect ?? "", container], {
    [container]: { sel: container, children },
  });
}

/** The ordinary counts shape: the actor block, then the counts row. */
function legacyPageWith(row: ElementSpec): unknown {
  return legacyPage([LEGACY_AUTHOR_ANCHOR, row]);
}

interface Counts {
  reactionCount: number;
  commentCount: number;
  shareCount: number;
}

describe("engagement counts (#836)", () => {
  const script = buildPostDetailExtractionSource(adaptersFor("post-detail"));

  it("reproduces the live row: what a reader saw, and what textContent gives", () => {
    // Guard on this suite's own premise, and the reason the fixture is a TREE
    // rather than a string.  "2 41 comments" is the verbatim live rendering;
    // the space in it is an element boundary, not a character, so the
    // concatenation a page-wide read sees is "241 comments".  If either half
    // ever stops holding, the assertions below would be grading a page shape
    // LinkedIn never served.
    expect(renderedText(LIVE_COUNTS_ROW)).toBe("2 41 comments");
    expect(specText(LIVE_COUNTS_ROW)).toBe("241 comments");
  });

  it("reads each counter from the element that renders it", () => {
    // The headline acceptance criterion: "2 41 comments" yields 2 and 41 —
    // not 241, which is what the flattened form parses to, and not 0
    // reactions, which is what a text-only read returns for a bare number.
    const result = runScript(script, legacyPageWith(LIVE_COUNTS_ROW)) as Counts;

    expect(result.commentCount).toBe(41);
    expect(result.reactionCount).toBe(2);
  });

  it("reads a narrowed counts row that renders both counters as one node", () => {
    // The same criterion against a row built the OTHER way: one element whose
    // whole text is the criterion's string.  Anchored matching finds no
    // counter here, and the strict read alone would report the post as having
    // none — visibly false for a row that renders "41 comments".  Inside a
    // row the adapter itself declared, a looser read of the row's own text is
    // warranted, and it recovers 41.
    //
    // `reactionCount` stays 0 by construction, not by omission: this string
    // carries no "reactions" token for any read to find.  Only the two-element
    // rendering above — where the count lives in a control's `aria-label` —
    // makes 2 recoverable at all.
    const result = runScript(
      script,
      legacyPageWith({ sel: ".social-details-social-counts", text: "2 41 comments" }),
    ) as Counts;

    expect(result.commentCount).toBe(41);
    expect(result.reactionCount).toBe(0);
  });

  it("does not read loosely when no counts anchor narrowed the root", () => {
    // The bound on the fallback above.  An un-narrowed root is the whole post
    // container, and the post's own prose is exactly where "a number followed
    // by the word comments" is a sentence rather than a counter — reading it
    // loosely there would reintroduce the defect this change removes, one
    // scope smaller.
    const result = runScript(
      buildPostDetailExtractionSource([THIRD_ADAPTER]),
      fakeDocument([THIRD_ADAPTER.detect, ...THIRD_ADAPTER.scopes], {
        [THIRD_ADAPTER.scopes[0] ?? ""]: {
          sel: THIRD_ADAPTER.scopes[0] ?? "",
          children: [{ sel: "span", text: "This post got 3 comments last week." }],
        },
      }),
    ) as Counts;

    expect(result.commentCount).toBe(0);
  });

  it("keeps thousands separators out of the parsed value", () => {
    const result = runScript(
      script,
      legacyPageWith({
        sel: ".social-details-social-counts",
        children: [
          { sel: "button", label: "1,234 reactions", text: "1,234" },
          { sel: "button", text: "5,678 comments" },
          { sel: "button", text: "90 reposts" },
        ],
      }),
    ) as Counts;

    expect(result.reactionCount).toBe(1234);
    expect(result.commentCount).toBe(5678);
    expect(result.shareCount).toBe(90);
  });

  it("reports zero for a post that renders no counts row", () => {
    // Load-bearing, not a nicety: `commentCount` is the cardinal that decides
    // whether an empty comment list is legitimate or a stale-selector failure
    // (#834).  A count invented for a post that has none would turn every such
    // post into a raised error.
    const result = runScript(
      script,
      legacyPageWith({ sel: "div", children: [{ sel: "span", text: "no counts here" }] }),
    ) as Counts;

    expect(result.reactionCount).toBe(0);
    expect(result.commentCount).toBe(0);
    expect(result.shareCount).toBe(0);
  });

  it("prefers the counts row over a counter rendered earlier in scope", () => {
    // What the `counts` anchor actually buys, isolated.  The stray counter is
    // placed BEFORE the row deliberately: an un-narrowed read starts its
    // containment chain at the first hit in document order, so without the
    // narrowing this page reports 999 — the post's own count decided by
    // whatever happens to render a counter above it.  Ordered the other way
    // round the row wins regardless, and the narrowing goes unexercised.
    const result = runScript(
      script,
      legacyPage([
        LEGACY_AUTHOR_ANCHOR,
        { sel: "div", children: [{ sel: "span", text: "999 comments" }] },
        LIVE_COUNTS_ROW,
      ]),
    ) as Counts;

    expect(result.commentCount).toBe(41);
  });

  it("falls back to the adapter's own scope when it declares no counts anchor", () => {
    // What every dialect with no measured counts row does, the registered
    // `sdui` adapter included.  Anchored per-element matching is what makes
    // the wider root safe.
    const result = runScript(
      buildPostDetailExtractionSource([THIRD_ADAPTER]),
      fakeDocument([THIRD_ADAPTER.detect, ...THIRD_ADAPTER.scopes], {
        [THIRD_ADAPTER.scopes[0] ?? ""]: {
          sel: THIRD_ADAPTER.scopes[0] ?? "",
          children: [LIVE_COUNTS_ROW],
        },
      }),
    ) as Counts;

    expect(result.reactionCount).toBe(2);
    expect(result.commentCount).toBe(41);
  });

  it("has no adapter narrowing its counts read with an always-true selector", () => {
    // The same guard the detect anchors carry, one field over: a `counts`
    // candidate matching every page would put the whole document back inside
    // the read this change took it out of.
    const alwaysTrue = ["main", "body", "html", ":root", "*", "document"];
    for (const adapter of adaptersFor("post-detail")) {
      for (const candidate of adapter.counts) {
        expect(alwaysTrue).not.toContain(candidate.trim());
      }
    }
  });
});

describe("author identity (#836)", () => {
  const script = buildPostDetailExtractionSource(adaptersFor("post-detail"));

  interface Author {
    authorName: string | null;
    authorHeadline: string | null;
    authorProfileUrl: string | null;
  }

  /** A legacy update container wrapping one author anchor and nothing else. */
  function legacyPageWithAnchor(anchor: ElementSpec): unknown {
    return legacyPage([anchor]);
  }

  /**
   * The legacy actor block: LinkedIn writes each field twice inside the
   * anchor — the copy a reader sees, wrapped in `aria-hidden="true"`, and an
   * assistive-technology twin beside it — with `span[dir="ltr"]` wrapping the
   * PAIR.  Reading that wrapper is what returned the name doubled.
   */
  const ACTOR_BLOCK: ElementSpec = {
    sel: 'a[href*="/in/"]',
    href: "https://www.linkedin.com/in/alexey-pelykh/",
    children: [
      {
        sel: 'span[dir="ltr"], span',
        children: [
          { sel: 'span, [aria-hidden="true"]', text: "Alexey Pelykh" },
          { sel: "span", text: "Alexey Pelykh" },
        ],
      },
      {
        sel: "span",
        children: [
          {
            sel: 'span, [aria-hidden="true"]',
            text: "Software Architect | Agentic AI",
          },
          { sel: "span", text: "Software Architect | Agentic AI" },
        ],
      },
    ],
  };

  it("returns the name once, from the copy a reader sees", () => {
    const result = runScript(script, legacyPageWithAnchor(ACTOR_BLOCK)) as Author;

    expect(result.authorName).toBe("Alexey Pelykh");
    expect(result.authorProfileUrl).toBe(
      "https://www.linkedin.com/in/alexey-pelykh/",
    );
  });

  it("returns the headline, not the name", () => {
    const result = runScript(script, legacyPageWithAnchor(ACTOR_BLOCK)) as Author;

    expect(result.authorHeadline).toBe("Software Architect | Agentic AI");
  });

  it("collapses a name a dialect renders twice inside one element", () => {
    // No wrapper separates the two copies here, so nothing structural tells
    // them apart — this is the residue the live record carried as
    // "Alexey PelykhAlexey Pelykh".
    const result = runScript(
      script,
      legacyPageWithAnchor({
        sel: 'a[href*="/in/"]',
        href: "https://www.linkedin.com/in/alexey-pelykh/",
        children: [{ sel: "span", text: "Alexey PelykhAlexey Pelykh" }],
      }),
    ) as Author;

    expect(result.authorName).toBe("Alexey Pelykh");
  });

  it("drops the connection degree and the Premium badge from the name", () => {
    // The decorations as the live record carried them: mid-string, not
    // suffixed, which is why each is truncated from its first occurrence.
    const result = runScript(
      script,
      legacyPageWithAnchor({
        sel: 'a[href*="/in/"]',
        href: "https://www.linkedin.com/in/alexey-pelykh/",
        children: [
          {
            sel: "span",
            text: "Alexey Pelykh • YouPremium • You Software Architect",
          },
        ],
      }),
    ) as Author;

    expect(result.authorName).toBe("Alexey Pelykh");
  });

  it("keeps a company name that merely begins with a badge word", () => {
    // The badge rule is narrow on purpose: "Premium" is only a decoration
    // when it trails the name or introduces "Premium Profile".
    const result = runScript(
      script,
      legacyPageWithAnchor({
        sel: 'a[href*="/company/"]',
        href: "https://www.linkedin.com/company/premium-motors/",
        children: [{ sel: "span", text: "Premium Motors" }],
      }),
    ) as Author;

    expect(result.authorName).toBe("Premium Motors");
  });

  it("does not take a candidate that is the author's name in disguise", () => {
    // An equality test passed the plain name through as the headline whenever
    // the name itself came back mangled.
    const result = runScript(
      script,
      legacyPageWithAnchor({
        sel: 'a[href*="/in/"]',
        href: "https://www.linkedin.com/in/alexey-pelykh/",
        children: [
          {
            sel: 'span[dir="ltr"], span',
            children: [
              { sel: 'span, [aria-hidden="true"]', text: "Alexey Pelykh" },
              { sel: "span", text: "Alexey Pelykh" },
            ],
          },
          // The discriminating candidate: an unwrapped element rendering the
          // a11y pair.  It is NOT equal to the name, so an equality test lets
          // it through and it becomes the headline; reducing it first — the
          // same reduction the name read applies — rejects it.
          { sel: "span", text: "Alexey PelykhAlexey Pelykh" },
          { sel: "span", text: "Software Architect | Agentic AI" },
        ],
      }),
    ) as Author;

    expect(result.authorName).toBe("Alexey Pelykh");
    expect(result.authorHeadline).toBe("Software Architect | Agentic AI");
  });

  it("keeps a headline that names its own owner", () => {
    // The bound on the rule above, and the reason it reduces rather than
    // merely testing containment: "<Name> | <role>" is one of the commonest
    // headline shapes LinkedIn renders, and dropping it would replace a
    // visibly wrong headline with a silently absent one.
    const result = runScript(
      script,
      legacyPageWithAnchor({
        sel: 'a[href*="/in/"]',
        href: "https://www.linkedin.com/in/jane-doe/",
        children: [
          { sel: 'span, [aria-hidden="true"]', text: "Jane Doe" },
          { sel: "span", text: "Jane Doe | Head of Data" },
        ],
      }),
    ) as Author;

    expect(result.authorName).toBe("Jane Doe");
    expect(result.authorHeadline).toBe("Jane Doe | Head of Data");
  });

  it("keeps a headline that uses a bullet as its own separator", () => {
    // The composite this rejects is "<Name> • <degree>", so the rule keys on
    // the degree.  Rejecting every bullet would drop a real headline.
    const result = runScript(
      script,
      legacyPageWithAnchor({
        sel: 'a[href*="/in/"]',
        href: "https://www.linkedin.com/in/alexey-pelykh/",
        children: [
          { sel: 'span, [aria-hidden="true"]', text: "Alexey Pelykh" },
          { sel: "span", text: "Software Architect • Agentic AI" },
        ],
      }),
    ) as Author;

    expect(result.authorHeadline).toBe("Software Architect • Agentic AI");
  });
});
