// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";
import {
  adaptersFor,
  asVariantDetection,
  buildDetectionSource,
  buildPostDetailExtractionSource,
  buildReadinessPredicateSource,
  buildSearchResultsExtractionSource,
  formatVariantProbes,
  KNOWN_DOM_VARIANTS,
  type PostDetailVariantAdapter,
  SEARCH_RESULT_CARD_MENU_BUTTON,
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
    // A contentless stand-in has no laid-out box.  Stated rather than left
    // `undefined`, because `undefined < 100` is `false` — an omitted height
    // would sail through the search-results card-height filter, which is the
    // false pass in the safe-looking direction.
    offsetHeight: 0,
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
  /** `datetime`, where the element is a `<time>`. */
  readonly datetime?: string;
  /** This element's own text.  Leaves only, as in real markup. */
  readonly text?: string;
  /**
   * Laid-out height, defaulting to 0.
   *
   * Only the search-results surface reads it, and there it is a FILTER — a
   * card below 100px is not a post, and a media image below 100px is a
   * thumbnail rather than the post's media.  Defaulting to 0 rather than to
   * something comfortably tall is deliberate: a fixture that forgets to set a
   * height gets skipped and its assertion fails loudly, instead of silently
   * grading a card the filter would have dropped.
   */
  readonly height?: number;
  readonly children?: readonly ElementSpec[];
}

interface FakeEl {
  readonly textContent: string;
  readonly href: string;
  readonly offsetHeight: number;
  /** Every descendant in document order.  Node identity is stable, which is
   *  what makes `contains` an ancestry test rather than a value comparison. */
  readonly descendants: FakeEl[];
  getAttribute(name: string): string | null;
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
  closest(sel: string): FakeEl | null;
  contains(other: FakeEl): boolean;
  /** Deep copy, as `Node.cloneNode(true)`. */
  cloneNode(deep: boolean): FakeEl;
  /** Detach from the parent, as `ChildNode.remove()`. */
  remove(): void;
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

/**
 * Build a live node from a spec.
 *
 * `children` is MUTABLE and `textContent` / `descendants` are getters over it,
 * so `remove()` actually changes what an ancestor's text reads as — which is
 * the whole behaviour the SDUI search-results extractor depends on when it
 * strips a "… more" affordance out of a cloned text box.  Node identity is
 * still built once per node, so `contains` stays an ancestry test rather than
 * a value comparison.
 */
function buildElement(spec: ElementSpec, parent?: { children: FakeEl[] }): FakeEl {
  const holder: { children: FakeEl[] } = { children: [] };
  const matchesSelf = (sel: string): boolean =>
    sel.trim() === "*" || selectorMatches([spec.sel ?? ""], sel);
  const self: FakeEl = {
    get textContent(): string {
      return (
        (spec.text ?? "") +
        holder.children.map((child) => child.textContent).join("")
      );
    },
    href: spec.href ?? "",
    offsetHeight: spec.height ?? 0,
    get descendants(): FakeEl[] {
      return holder.children.flatMap((child) => [child, ...child.descendants]);
    },
    getAttribute: (name: string) => {
      if (name === "aria-label") return spec.label ?? null;
      if (name === "href") return spec.href ?? null;
      if (name === "datetime") return spec.datetime ?? null;
      return null;
    },
    querySelectorAll: (sel: string) =>
      self.descendants.filter((node) => node.matchesSelector(sel)),
    querySelector: (sel: string) =>
      self.descendants.find((node) => node.matchesSelector(sel)) ?? null,
    closest: () => null,
    contains: (other: FakeEl) =>
      other === self || self.descendants.includes(other),
    // A fresh tree off the same spec.  Sound here because every clone in play
    // is taken BEFORE any mutation, exactly as the extractor does it.
    cloneNode: () => buildElement(spec),
    remove: () => {
      if (!parent) return;
      const at = parent.children.indexOf(self);
      if (at >= 0) parent.children.splice(at, 1);
    },
    matchesSelector: matchesSelf,
  };
  holder.children = (spec.children ?? []).map((child) =>
    buildElement(child, holder),
  );
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
const THIRD_ADAPTER: PostDetailVariantAdapter = {
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
    const nasty: PostDetailVariantAdapter = {
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
  const broken: PostDetailVariantAdapter = {
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
    const split: PostDetailVariantAdapter = {
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

// ───────────────────────────────────────────────────────────────────────────
// search-results (#841)
// ───────────────────────────────────────────────────────────────────────────

/**
 * A search-results page.
 *
 * `cards` supplies the LIST a card-enumeration selector answers with.  That
 * is the whole reason this exists beside {@link fakeDocument}: post detail
 * reads ONE root, so a `querySelectorAll` returning a single element was
 * enough there, and on this surface it would hide every multi-card behaviour
 * — the enumeration order, the per-card filters, and the cardinal that counts
 * cards the extraction skipped.
 */
function fakeSearchDocument(
  present: readonly string[],
  cards: Readonly<Record<string, readonly ElementSpec[]>> = {},
): unknown {
  const listFor = (sel: string): FakeEl[] | null => {
    for (const [key, specs] of Object.entries(cards)) {
      if (selectorMatches([key], sel)) return specs.map((s) => buildElement(s));
    }
    return null;
  };
  const matches = (sel: string): boolean => selectorMatches(present, sel);
  return {
    querySelector: (sel: string) => {
      const list = listFor(sel);
      if (list !== null) return list[0] ?? null;
      return matches(sel) ? fakeElement(sel) : null;
    },
    querySelectorAll: (sel: string) => {
      const list = listFor(sel);
      if (list !== null) return list;
      return matches(sel) ? [fakeElement(sel)] : [];
    },
  };
}

/**
 * The per-card three-dot control menu, carrying the author name in its label.
 *
 * Written out literally rather than imported: this exact selector is the
 * adjudicated dialect-INDEPENDENT anchor, and pinning the string here is what
 * makes a later "tidy it into an adapter" edit fail a test rather than pass
 * review.  It is also the fixed end of the composition check on
 * {@link SEARCH_RESULT_CARD_MENU_BUTTON} — a pin only holds if one side of it
 * is not the thing under test.
 */
const SEARCH_MENU_BUTTON = 'button[aria-label^="Open control menu for post"]';

function menuButton(name: string): ElementSpec {
  return {
    sel: SEARCH_MENU_BUTTON,
    label: `Open control menu for post by ${name}`,
  };
}

/**
 * An SDUI search-result card, as the 2026-04-15 live probe recorded one.
 *
 * Both author anchors answer to the profile-path selector, as a browser's
 * would: the first is avatar-only (empty text, which is why the name cannot
 * come from it) and the second carries the `<p>` run with name, degree,
 * headline and timestamp.
 */
const SDUI_CARD: ElementSpec = {
  sel: 'div[role="listitem"]',
  height: 320,
  children: [
    {
      sel: 'a[href*="/in/"], a[href*="/in/alice/"]',
      href: "https://www.linkedin.com/in/alice/?trk=search_srp",
      children: [{ sel: "figure" }],
    },
    menuButton("Alice Smith"),
    {
      sel: 'a[href*="/in/"], a[href*="/in/alice/"]',
      href: "https://www.linkedin.com/in/alice/?trk=search_srp",
      children: [
        { sel: "p", text: "Alice Smith" },
        { sel: "p", text: "• 1st" },
        { sel: "p", text: "Engineer at Acme" },
        { sel: "p", text: "18h •" },
      ],
    },
    {
      sel: '[data-testid="expandable-text-box"]',
      children: [
        { sel: "span", text: "Hello #linkedin world!" },
        { sel: '[data-testid="expandable-text-button"]', text: "…more" },
      ],
    },
    { sel: 'img[src*="media.licdn.com"]', height: 240 },
    { sel: "span", text: " 42 reactions" },
    { sel: "span", text: " 7 comments" },
    { sel: "span", text: " 3 reposts" },
  ],
};

/**
 * A legacy search-result card, reconstructed from the 2026-03-26 selector
 * study and the diff of `24052dd`.
 *
 * The author name appears ONLY in the control menu's label — no span carries
 * it.  That is deliberate and it is the discriminating part of the fixture:
 * the legacy read this dialect used before `24052dd` took the name off a span
 * inside the first author anchor, which is avatar-only, and reviving it would
 * ship a known-broken read under a new name.
 */
const LEGACY_CARD: ElementSpec = {
  sel: "[data-chameleon-result-urn]",
  height: 280,
  children: [
    {
      sel: 'a[href*="/in/"]',
      href: "https://www.linkedin.com/in/bob/?trk=search_srp",
      children: [{ sel: "figure" }],
    },
    menuButton("Bob Jones"),
    { sel: "span", text: "Follow" },
    { sel: "span", text: "Staff Engineer at Globex" },
    {
      sel: 'span, span[dir="ltr"]',
      text: "A legacy-rendered post body, long enough to clear the floor.",
    },
    { sel: "time", datetime: "2026-04-14T09:30:00.000Z" },
    { sel: "span", text: " 5 reactions" },
    { sel: "span", text: " 2 comments" },
    { sel: "span", text: " 1 repost" },
  ],
};

interface SearchScrape {
  variant?: string;
  postCardCount?: number;
  posts?: {
    url: string | null;
    authorName: string | null;
    authorHeadline: string | null;
    authorProfileUrl: string | null;
    text: string | null;
    mediaType: string | null;
    reactionCount: number;
    commentCount: number;
    shareCount: number;
    timestamp: string | null;
  }[];
  ambiguousVariants?: string[];
}

describe("search-results adapter registry", () => {
  const adapters = adaptersFor("search-results");
  const [sdui, legacy] = adapters;

  it("registers the known search-results dialects", () => {
    expect(variantNamesFor("search-results")).toEqual([...KNOWN_DOM_VARIANTS]);
  });

  it("has no adapter whose detect anchor or scope is an always-true selector", () => {
    // The same guard the post-detail adapters carry.  An adapter claiming
    // every page claims pages it cannot read, and a scope matching every page
    // enumerates "cards" that are not cards.
    const alwaysTrue = ["main", "body", "html", ":root", "*", "document"];
    for (const adapter of adapters) {
      expect(alwaysTrue).not.toContain(adapter.detect.trim());
      for (const scope of adapter.scopes) {
        expect(alwaysTrue).not.toContain(scope.trim());
      }
      expect(adapter.scopes.length).toBeGreaterThan(0);
    }
  });

  it("shares one readiness anchor across both dialects, deliberately", () => {
    // The post-detail suite asserts the OPPOSITE for its surface, so this is
    // recorded as an intended difference rather than left to look like a
    // slip.  The readiness predicate is a CONJUNCTION — exactly one adapter's
    // `detect` matched AND that adapter's `ready` is present — so the dialect
    // binding already lives in `detect`, which is dialect-exclusive.  `ready`
    // carries the orthogonal claim that a card has HYDRATED, and the card
    // skeleton is precisely what the two dialects share.  A per-dialect
    // hydration anchor would be a measurement nobody has taken.
    expect(sdui?.ready).toBe(legacy?.ready);
  });

  it("polls a readiness anchor the extraction itself requires", () => {
    // The ADR-008 binding, in the form that survives a shared anchor: the
    // gate must not go green on something the extractor does not need.  A
    // card with no control menu is skipped by the shared card loop, so the
    // anchor is load-bearing for extraction and not merely for liveness.
    expect(sdui?.ready).toContain(SEARCH_MENU_BUTTON);
    expect(buildSearchResultsExtractionSource(adapters)).toContain(
      JSON.stringify(SEARCH_MENU_BUTTON),
    );
  });

  it("exports one card-menu selector for the gate and the URL read to share", () => {
    // `search-posts.ts` clicks these buttons to read each post's URL off the
    // "Copy link to post" item, and used to hand-write the same two parts a
    // third time.  Pinning the composed export against the literals is what
    // keeps that de-duplication honest: a change to either part now has to
    // move the gate, the card filter and the URL read together, or fail here.
    expect(SEARCH_RESULT_CARD_MENU_BUTTON).toBe(
      `div[role="listitem"] ${SEARCH_MENU_BUTTON}`,
    );
    for (const adapter of adapters) {
      expect(adapter.ready).toBe(SEARCH_RESULT_CARD_MENU_BUTTON);
    }
  });

  it("keeps the control-menu anchor out of both adapters", () => {
    // Adjudicated dialect-independent (ARIA, measured on pre-SDUI markup in
    // 2026-03, measured on the post-flip search page in 2026-04, and an
    // unchanged context line through the migration that flipped the dialect).
    // It belongs to the shared card skeleton; duplicating it per dialect is
    // how two copies of one measurement drift apart.
    for (const adapter of adapters) {
      expect(adapter.detect).not.toContain("Open control menu");
      expect(adapter.extract).not.toContain("Open control menu");
    }
  });

  it("confines the SDUI attribute scheme to the SDUI adapter", () => {
    // Acceptance criterion 2, structurally: every `[data-testid]` anchor now
    // lives inside the dialect that owns it.  Under legacy markup they all
    // match zero, which is exactly why a legacy page must not reach one.
    expect(sdui?.detect).toContain("data-testid");
    expect(sdui?.extract).toContain('[data-testid="expandable-text-box"]');
    expect(legacy?.detect).not.toContain("data-testid");
    expect(legacy?.extract).not.toContain("data-testid");
  });

  it("never decides a branch by the ABSENCE of a variant-specific attribute", () => {
    // The defect this item removes: `!document.querySelector('[data-testid=
    // "mainFeed"]')` as a discriminator.  Under legacy that negation is TRUE
    // — not because the condition it tests for holds, but because the whole
    // attribute scheme is gone — so it took the wrong branch instead of
    // failing.  A check that cannot fail is not a check.
    const sources = [
      buildSearchResultsExtractionSource(adapters),
      buildReadinessPredicateSource(adapters),
      buildDetectionSource(adapters),
    ];
    for (const source of sources) {
      expect(source).not.toMatch(/!\s*document\.querySelector/);
    }
  });
});

describe("search-results readiness predicate", () => {
  const adapters = adaptersFor("search-results");
  const script = buildReadinessPredicateSource(adapters);
  const [sdui, legacy] = adapters;

  it("is false when no adapter claims the page", () => {
    expect(runScript(script, fakeSearchDocument([]))).toBe(false);
  });

  it("is false when the sole claimant's own ready anchor is absent", () => {
    expect(runScript(script, fakeSearchDocument([sdui?.detect ?? ""]))).toBe(
      false,
    );
  });

  it("is true for an SDUI page whose cards have hydrated", () => {
    expect(
      runScript(
        script,
        fakeSearchDocument([sdui?.detect ?? "", sdui?.ready ?? ""]),
      ),
    ).toBe(true);
  });

  it("is true for a legacy page whose cards have hydrated", () => {
    // The case the replaced gate could not distinguish: it asked only whether
    // some listitem held a control menu, which is true on both dialects, so
    // it went green on a page every SDUI selector matched zero on.
    expect(
      runScript(
        script,
        fakeSearchDocument([legacy?.detect ?? "", legacy?.ready ?? ""]),
      ),
    ).toBe(true);
  });

  it("is false when two adapters claim the page, even with the ready anchor present", () => {
    expect(
      runScript(
        script,
        fakeSearchDocument([
          sdui?.detect ?? "",
          legacy?.detect ?? "",
          sdui?.ready ?? "",
        ]),
      ),
    ).toBe(false);
  });
});

describe("search-results extraction", () => {
  const adapters = adaptersFor("search-results");
  const script = buildSearchResultsExtractionSource(adapters);
  const [sdui, legacy] = adapters;

  /** An SDUI search page holding `cards` under the listitem enumeration. */
  function sduiPage(cards: readonly ElementSpec[]): unknown {
    return fakeSearchDocument([sdui?.detect ?? ""], {
      'div[role="listitem"]': cards,
    });
  }

  /** A legacy search page holding `cards` under the chameleon container. */
  function legacyPage(cards: readonly ElementSpec[]): unknown {
    return fakeSearchDocument([legacy?.detect ?? ""], {
      "[data-chameleon-result-urn]": cards,
    });
  }

  it("returns null when no adapter claims the page", () => {
    expect(runScript(script, fakeSearchDocument([]))).toBeNull();
  });

  it("returns null when the claiming adapter enumerates no cards", () => {
    // Detect matched but no scope candidate yielded an element.  There is
    // deliberately no widening step, so this is "no usable adapter", not
    // "a search that found nothing" — and the distinction is the whole
    // empty-vs-error contract: `null` raises, a zero-card record does not.
    expect(
      runScript(script, fakeSearchDocument([sdui?.detect ?? ""])),
    ).toBeNull();
  });

  it("reports the claimants when two adapters match, instead of picking one", () => {
    const result = runScript(
      script,
      fakeSearchDocument([sdui?.detect ?? "", legacy?.detect ?? ""]),
    ) as SearchScrape;
    expect(result.ambiguousVariants).toEqual([...KNOWN_DOM_VARIANTS]);
  });

  it("extracts a full record under the SDUI dialect", () => {
    const result = runScript(script, sduiPage([SDUI_CARD])) as SearchScrape;

    expect(result.variant).toBe("sdui");
    expect(result.postCardCount).toBe(1);
    expect(result.posts).toHaveLength(1);
    const [post] = result.posts ?? [];
    expect(post?.authorName).toBe("Alice Smith");
    expect(post?.authorHeadline).toBe("Engineer at Acme");
    expect(post?.authorProfileUrl).toBe("https://www.linkedin.com/in/alice/");
    // The "… more" affordance is stripped out of a CLONE, so the live page is
    // never mutated and the post text is what a reader sees.
    expect(post?.text).toBe("Hello #linkedin world!");
    expect(post?.timestamp).toBe("18h");
    expect(post?.mediaType).toBe("image");
    expect(post?.reactionCount).toBe(42);
    expect(post?.commentCount).toBe(7);
    expect(post?.shareCount).toBe(3);
    // Filled later by the three-dot-menu phase; search results expose no URL.
    expect(post?.url).toBeNull();
  });

  it("extracts a full record under the legacy dialect", () => {
    // The headline acceptance criterion. Every `[data-testid]` matches zero on
    // this page, which is precisely how search results extracted empty before:
    // the SDUI text box, the SDUI "… more" button and the negated `mainFeed`
    // probe were the only reads, and none of them can see this markup.
    const result = runScript(script, legacyPage([LEGACY_CARD])) as SearchScrape;

    expect(result.variant).toBe("legacy");
    expect(result.postCardCount).toBe(1);
    expect(result.posts).toHaveLength(1);
    const [post] = result.posts ?? [];
    expect(post?.authorName).toBe("Bob Jones");
    expect(post?.authorHeadline).toBe("Staff Engineer at Globex");
    expect(post?.authorProfileUrl).toBe("https://www.linkedin.com/in/bob/");
    expect(post?.text).toBe(
      "A legacy-rendered post body, long enough to clear the floor.",
    );
    expect(post?.timestamp).toBe("2026-04-14T09:30:00.000Z");
    expect(post?.reactionCount).toBe(5);
    expect(post?.commentCount).toBe(2);
    expect(post?.shareCount).toBe(1);
  });

  it("reads the author name off the control menu under legacy, not off a span", () => {
    // `LEGACY_CARD` carries the name in the menu label and nowhere else, so
    // this passes only if the shared builder is the one reading it.  The span
    // read that `24052dd` replaced was already broken — the first author
    // anchor on a card is avatar-only — and reviving it into this adapter
    // would ship a known bug under a new name.
    const result = runScript(script, legacyPage([LEGACY_CARD])) as SearchScrape;
    const [post] = result.posts ?? [];

    expect(post?.authorName).toBe("Bob Jones");
    expect(legacy?.extract).not.toContain("aria-hidden");
  });

  it("falls back to the card's own text for a legacy timestamp with no <time>", () => {
    const noTimeEl: ElementSpec = {
      ...LEGACY_CARD,
      children: [
        { sel: "span", text: "2w · " },
        ...(LEGACY_CARD.children ?? []).filter((child) => child.sel !== "time"),
      ],
    };
    const result = runScript(script, legacyPage([noTimeEl])) as SearchScrape;

    expect(result.posts?.[0]?.timestamp).toBe("2w");
  });

  it("raises nothing itself, but reports a cardinal that contradicts an empty scrape", () => {
    // Corroborated-empty, at the layer that produces the evidence: a card
    // that is post-shaped — tall enough, with an author link — but whose
    // control menu never resolved. `postCardCount` counts it; `posts` does
    // not. The operation is what turns that disagreement into an
    // `ExtractionFailedError`; the script's job is to make it visible.
    const menuless: ElementSpec = {
      ...SDUI_CARD,
      children: (SDUI_CARD.children ?? []).filter(
        (child) => child.sel !== SEARCH_MENU_BUTTON,
      ),
    };
    const result = runScript(script, sduiPage([menuless])) as SearchScrape;

    expect(result.postCardCount).toBe(1);
    expect(result.posts).toEqual([]);
  });

  it("reports a zero cardinal for a page that renders no post-shaped cards", () => {
    // The other half of the contract, and the half a naive "empty means
    // stale" rule breaks: a search that genuinely found nothing. The cardinal
    // requires an author link, so a chrome or "no results" block is not
    // counted and the empty scrape is corroborated rather than contradicted.
    const noResults: ElementSpec = {
      sel: 'div[role="listitem"]',
      height: 180,
      children: [{ sel: "span", text: "No results found" }],
    };
    const result = runScript(script, sduiPage([noResults])) as SearchScrape;

    expect(result.postCardCount).toBe(0);
    expect(result.posts).toEqual([]);
  });

  it("skips cards below the height floor without counting them", () => {
    // The height filter is shared with the cardinal, deliberately: counting a
    // card the extraction was never going to read would make the corroborator
    // fire on a page that is fine.
    const short: ElementSpec = { ...SDUI_CARD, height: 40 };
    const result = runScript(script, sduiPage([short, SDUI_CARD]));

    expect((result as SearchScrape).postCardCount).toBe(1);
    expect((result as SearchScrape).posts).toHaveLength(1);
  });

  it("enumerates every card on the page, not just the first", () => {
    const result = runScript(
      script,
      sduiPage([SDUI_CARD, SDUI_CARD, SDUI_CARD]),
    ) as SearchScrape;

    expect(result.postCardCount).toBe(3);
    expect(result.posts).toHaveLength(3);
  });

  it("reads no page-wide text at all", () => {
    // Counts are per-post here and are read from each card's own text. A
    // page-wide read would make the first "<N> comments"-shaped run anywhere
    // on the page every post's comment count.
    expect(script).not.toContain("document.body");
  });
});
