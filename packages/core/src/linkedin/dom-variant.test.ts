// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";
import {
  adaptersFor,
  asVariantDetection,
  buildDetectionSource,
  buildPostDetailAnchorProbeSource,
  buildPostDetailExtractionSource,
  buildReactionsModalExtractionSource,
  buildReactionsModalScrollSource,
  buildReactionsModalTotalSource,
  buildReactionsTriggerSource,
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
    // A contentless stand-in scrolls nowhere: `scrollHeight === clientHeight`,
    // so the clamp in `buildElement` pins any write to 0.  Stated rather than
    // omitted for the same reason `offsetHeight` is — an absent field would
    // make `scrollTop += 500` read as `NaN`, which compares false against
    // everything and would look like a decline for the wrong reason.
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    overflowY: "visible",
    getAttribute: () => null,
    // A no-op rather than an omission: the trigger script MARKS the element it
    // picks, and a stand-in without this throws where a browser would simply
    // record the attribute (#840).
    setAttribute: () => undefined,
    parentElement: null,
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    // Answers for itself, as a real element does.  A stand-in reached by a
    // walk that asks `matches` would otherwise throw where a browser answers.
    matches: (candidate: string) => selectorMatches([sel], candidate),
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
  /**
   * Any other attribute, by name.  The three above predate this and stay as
   * named fields because most fixtures set them; anything else — `alt` on a
   * reaction pictogram, a marker a script writes and reads back — goes here.
   */
  readonly attrs?: Readonly<Record<string, string>>;
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
  /**
   * Computed `overflow-y`, defaulting to `visible`.
   *
   * Only the reactions-modal scroll source reads it, and it reads it through
   * `getComputedStyle` — which the `new Function("document", ...)` harness does
   * not otherwise put in scope, so the positive scroll path could not run at
   * all before this existed (#840).
   */
  readonly overflowY?: string;
  /** Scrollable content height, defaulting to 0. */
  readonly scrollHeight?: number;
  /** Laid-out viewport height of the scroll box, defaulting to 0. */
  readonly clientHeight?: number;
  readonly children?: readonly ElementSpec[];
}

interface FakeEl {
  readonly textContent: string;
  readonly href: string;
  readonly offsetHeight: number;
  /**
   * Scroll offset, as a browser's: MUTABLE, and CLAMPED to
   * `[0, scrollHeight - clientHeight]` on write.
   *
   * The clamp is what makes the scroll source falsifiable here.  Without it,
   * `scrollable.scrollTop += 500` moves on every element, so a source that
   * picked the wrong node — or that never found a scrollable region and fell
   * back to the modal — would still report `true`, and the test would pass on
   * the exact defect it exists to catch.
   */
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  /** What the harness's `getComputedStyle` shim reports for this element. */
  readonly overflowY: string;
  /** Every descendant in document order.  Node identity is stable, which is
   *  what makes `contains` an ancestry test rather than a value comparison. */
  readonly descendants: FakeEl[];
  getAttribute(name: string): string | null;
  /** Record an attribute, as `Element.setAttribute`. */
  setAttribute(name: string, value: string): void;
  /** The parent element, `null` at a root.  Mutable: set while building. */
  parentElement: FakeEl | null;
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
  closest(sel: string): FakeEl | null;
  contains(other: FakeEl): boolean;
  /** Deep copy, as `Node.cloneNode(true)`. */
  cloneNode(deep: boolean): FakeEl;
  /** Detach from the parent, as `ChildNode.remove()`. */
  remove(): void;
  /**
   * Whether this element answers to `sel`; `*` answers to everything.
   *
   * Named for the DOM API rather than for the harness, because a generated
   * script now CALLS it: the SDUI modal walk asks each ancestor whether it is
   * one of the document-level elements the module forbids as a scope (#840).
   */
  matches(sel: string): boolean;
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
  // Attributes a SCRIPT wrote, which shadow the spec's own.  Kept separate so
  // a fixture stays a description of the page as served, and what a script did
  // to it stays visible as a change.
  const written: Record<string, string> = {};
  const matchesSelf = (sel: string): boolean => {
    // Bare attribute-presence selectors are matched against what was written,
    // because that is how a script finds the element it marked earlier.
    for (const part of sel.split(",")) {
      const attr = /^\[([\w-]+)\]$/.exec(part.trim())?.[1];
      if (attr !== undefined && attr in written) return true;
    }
    return sel.trim() === "*" || selectorMatches([spec.sel ?? ""], sel);
  };
  // Clamped exactly as a browser clamps it — see `FakeEl.scrollTop`.
  const scrollCeiling = Math.max(
    0,
    (spec.scrollHeight ?? 0) - (spec.clientHeight ?? 0),
  );
  let scrollOffset = 0;
  const self: FakeEl = {
    get textContent(): string {
      return (
        (spec.text ?? "") +
        holder.children.map((child) => child.textContent).join("")
      );
    },
    href: spec.href ?? "",
    offsetHeight: spec.height ?? 0,
    get scrollTop(): number {
      return scrollOffset;
    },
    set scrollTop(value: number) {
      scrollOffset = Math.max(0, Math.min(value, scrollCeiling));
    },
    scrollHeight: spec.scrollHeight ?? 0,
    clientHeight: spec.clientHeight ?? 0,
    overflowY: spec.overflowY ?? "visible",
    get descendants(): FakeEl[] {
      return holder.children.flatMap((child) => [child, ...child.descendants]);
    },
    getAttribute: (name: string) => {
      if (name in written) return written[name] ?? null;
      if (name === "aria-label") return spec.label ?? null;
      if (name === "href") return spec.href ?? null;
      if (name === "datetime") return spec.datetime ?? null;
      return spec.attrs?.[name] ?? null;
    },
    setAttribute: (name: string, value: string) => {
      written[name] = value;
    },
    parentElement: null,
    querySelectorAll: (sel: string) =>
      self.descendants.filter((node) => node.matches(sel)),
    querySelector: (sel: string) =>
      self.descendants.find((node) => node.matches(sel)) ?? null,
    // A real ancestor walk, self included.  It used to return `null`
    // unconditionally, which is fine for a surface that reads one root and
    // wrong for one that reads rows: the engager scrape finds a row by walking
    // UP from its profile link (#840).
    closest: (sel: string) => {
      let node: FakeEl | null = self;
      while (node) {
        if (node.matches(sel)) return node;
        node = node.parentElement;
      }
      return null;
    },
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
    matches: matchesSelf,
  };
  holder.children = (spec.children ?? []).map((child) =>
    buildElement(child, holder),
  );
  for (const child of holder.children) child.parentElement = self;
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

/**
 * `getComputedStyle`, as much of it as any generated script reads.
 *
 * The reactions-modal scroll source picks its scroll container by computed
 * `overflow-y`.  That global is not in scope inside a
 * `new Function("document", ...)` body, so before this shim existed the
 * positive scroll path threw a `ReferenceError` the moment it was exercised —
 * which is why only the never-reaches-it `false` path had a test (#840).
 *
 * A shim, and it is worth being explicit about the limit: it reports what the
 * FIXTURE declares, so it grades which element the source *chooses* and what
 * it *writes*, never what a browser would actually compute.  The real-browser
 * tier is what could falsify a belief about CSS.
 */
function fakeComputedStyle(el: unknown): { overflowY: string } {
  return { overflowY: (el as { overflowY?: string }).overflowY ?? "visible" };
}

function runScript(script: string, document: unknown): unknown {
  return new Function(
    "document",
    "getComputedStyle",
    `return ${script};`,
  )(document, fakeComputedStyle) as unknown;
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

  it("makes the diagnostic anchor probe report the new dialect with no call-site change", () => {
    // The property the generator's PARAMETER exists for, and the only place
    // it is observable: the post-detail capture resolves the registry itself,
    // so a generator that also resolved it could never be handed a third
    // adapter and this criterion would have no test at any tier.
    //
    // A declaration spliced into an IIFE and called from it — the same
    // composition `wait-for-post-load.ts` performs, rather than a shape
    // invented here, so a source that only works when wrapped differently
    // does not pass.
    const readings = runScript(
      `(() => {${buildPostDetailAnchorProbeSource(extended)}
        return __lhPostDetailAnchorProbe();
      })()`,
      // Only the third dialect's READY anchor is on this page.  Its detect
      // anchor deliberately is not, which is what makes the `detect`-shaped
      // absence below an observation rather than a coincidence.
      fakeDocument([THIRD_ADAPTER.ready]),
    ) as Record<
      string,
      {
        ready: number;
        scopes: Record<string, number>;
        counts: Record<string, number>;
      }
    >;

    // Every registered dialect is named, the new one among them, and nothing
    // in `wait-for-post-load.ts` or `dom-variant.ts` was edited to add it.
    expect(Object.keys(readings).sort()).toEqual(
      extended.map((a) => String(a.variant)).sort(),
    );

    const third = readings.hypothetical;
    expect(third).toBeDefined();
    // Its own anchors, read off the page: ready present, scope absent.  Both
    // halves matter — an all-zero reading would also be produced by a probe
    // that emitted the right keys and looked at nothing.
    expect(third?.ready).toBe(1);
    expect(third?.scopes).toEqual({ [THIRD_ADAPTER.scopes[0] ?? ""]: 0 });
    // An adapter declaring no counts candidates contributes an empty object,
    // not a missing key: the absence is recorded rather than unwritten.
    expect(third?.counts).toEqual({});
    // `detect` carries no role of its own here by design: it is read on the
    // classification path and reaches the bundle as `variantDetection`.
    //
    // Asserted as SHAPE — the three roles and nothing else — rather than as
    // the absence of the detect STRING, which would be unsound twice over.
    // `JSON.stringify` escapes the quotes inside a selector, so a raw needle
    // never matches its own rendering and the check would pass for any
    // reading at all; and this fixture's `detect` IS its `scopes[0]`, exactly
    // as the real legacy adapter's is, so that string is legitimately a key
    // of `scopes` and an absence assertion would contradict the one above.
    // A role appearing that this probe does not own fails the shape.
    expect(Object.keys(third ?? {}).sort()).toEqual(
      ["counts", "ready", "scopes"].sort(),
    );
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

// ───────────────────────────────────────────────────────────────────────────
// reactions-modal (#840)
// ───────────────────────────────────────────────────────────────────────────

/**
 * A page for the reactions-modal scripts.
 *
 * Two properties the other two doubles do not have, and this surface needs
 * both.  The tree is built ONCE and kept, because the trigger script marks an
 * element and the total script reads that mark back in a LATER
 * `Runtime.evaluate` — a page that forgot it in between could not grade the
 * one handoff this surface is designed around.  And `querySelectorAll` answers
 * with every match rather than one, because the trigger script scans every
 * candidate its dialect declares and picks by accessible name.
 *
 * `present` is the escape hatch for a selector that should merely MATCH
 * without a tree behind it — a rival dialect's detect anchor in the ambiguity
 * cases, and the readiness anchors, which are descendant combinators the
 * spec-tree double matches by exact string.
 */
function fakeModalDocument(
  roots: readonly ElementSpec[],
  present: readonly string[] = [],
): unknown {
  const built = roots.map((spec) => buildElement(spec));
  const all = built.flatMap((el) => [el, ...el.descendants]);
  const find = (sel: string): FakeEl[] =>
    all.filter((el) => el.matches(sel));
  return {
    querySelector: (sel: string) => {
      const hit = find(sel)[0];
      if (hit) return hit;
      return selectorMatches(present, sel) ? fakeElement(sel) : null;
    },
    querySelectorAll: (sel: string) => {
      const hits = find(sel);
      if (hits.length > 0) return hits;
      return selectorMatches(present, sel) ? [fakeElement(sel)] : [];
    },
  };
}

/**
 * The trigger LinkedIn served on 2026-09-02, reproduced exactly.
 *
 * Every part of it is the defect: the words "reactions" live ONLY on the
 * `aria-label`, the element's own text is the bare `"2"`, and the reaction
 * pictograms sit between them. Written out literally rather than derived from
 * the adapter so that one side of the assertions below is not the thing under
 * test.
 */
const LEGACY_TRIGGER: ElementSpec = {
  sel: "button[data-reaction-details]",
  label: "2 reactions",
  height: 24,
  children: [
    { sel: "img", attrs: { alt: "like" } },
    { sel: "img", attrs: { alt: "celebrate" } },
    { sel: "span", text: "2" },
  ],
};

/** The text-only rule the trigger script replaced, verbatim. */
const SUPERSEDED_TEXT_ONLY_RULE = /^\d[\d,]*\s+reactions?$/i;

/** One engager row, as the modal renders one. */
function engagerRow(opts: {
  slug: string;
  name: string;
  headline: string;
  reaction: string;
}): ElementSpec {
  return {
    sel: "li",
    children: [
      {
        sel: 'a[href*="/in/"]',
        href: `https://www.linkedin.com/in/${opts.slug}/?trk=reactors`,
        children: [{ sel: '[aria-hidden="true"]', text: opts.name }],
      },
      // Rendered before the headline on purpose: it is an affordance label
      // that clears the headline rule's five-character floor, so a rule that
      // does not reject it returns "Connect" as this person's headline.
      { sel: "span", text: "Connect" },
      { sel: "span", text: opts.headline },
      { sel: "img[alt]", attrs: { alt: opts.reaction } },
    ],
  };
}

/**
 * One engager row rendered as an ACTOR LOCKUP: an avatar anchor with no text,
 * followed by a name-bearing anchor at the SAME href.
 *
 * The idiom this file already documents twice — post detail's "avatar (text
 * empty), name link, extended click area … All point to the same
 * `/in/{publicId}/`", and search results' "the first `a[href*=\"/in/\"]` on a
 * card is avatar-only".  {@link engagerRow} renders ONE anchor per row and so
 * cannot see it: the de-dup test passes `[ROW, ROW]`, which is two identical
 * READABLE rows.
 *
 * What it grades is the ORDER of two lines in the row loop.  Recording the
 * href in `seen` before the unusable-name reject lets the avatar consume the
 * de-dup slot, so the readable sibling is skipped and the row yields nothing —
 * on a fully-rendered modal, `engagers: []` beside a positive stamped total,
 * i.e. `ExtractionFailedError` (#840).
 */
function actorLockupRow(opts: {
  slug: string;
  name: string;
  headline: string;
  reaction: string;
}): ElementSpec {
  const href = `https://www.linkedin.com/in/${opts.slug}/?trk=reactors`;
  return {
    sel: "li",
    children: [
      { sel: 'a[href*="/in/"]', href, children: [{ sel: "img", text: "" }] },
      {
        sel: 'a[href*="/in/"]',
        href,
        children: [{ sel: '[aria-hidden="true"]', text: opts.name }],
      },
      { sel: "span", text: opts.headline },
      { sel: "img[alt]", attrs: { alt: opts.reaction } },
    ],
  };
}

/**
 * One engager row on a dialect whose rows are NOT `<li>`.
 *
 * Every other reactions-modal fixture uses `sel: "li"`, so the row walk's
 * second try — the class-bearing ancestor, which its own comment says exists
 * "for a dialect that does not use one" — is exercised by nothing.
 *
 * The anchor answers to `[class]` as well, and that is the whole fixture:
 * LinkedIn anchors always carry a class, and `Element.closest()` traverses
 * "the element AND its parents", so walking from the LINK returns the link
 * itself.  Both the headline scan and the pictogram scan are then scoped to
 * the anchor's own subtree, where neither exists — every engager comes back
 * `headline: null` and `engagementType: 'LIKE'`, with `extractedCount > 0` so
 * nothing raises and the wrong data ships silently (#840).
 *
 * The double matches selectors literally, so an element declares each one it
 * answers to; a real `<div class="…">` answers to both of the row's.
 */
function classRow(opts: {
  slug: string;
  name: string;
  headline: string;
  reaction: string;
}): ElementSpec {
  return {
    sel: "div, [class]",
    children: [
      {
        sel: 'a[href*="/in/"], [class]',
        href: `https://www.linkedin.com/in/${opts.slug}/?trk=reactors`,
        children: [{ sel: '[aria-hidden="true"]', text: opts.name }],
      },
      { sel: "span", text: opts.headline },
      { sel: "img[alt]", attrs: { alt: opts.reaction } },
    ],
  };
}

/**
 * One engager row on a dialect that nests the link MORE THAN ONE level inside
 * it — `div.row > div.name-wrapper > a`, the shape {@link classRow} does not
 * have.
 *
 * This is the residual the round-1 fix leaves behind.  Walking from the link's
 * PARENT stops `closest` returning the link itself, but it still answers with
 * the nearest classed ancestor OF THE ANCHOR, which here is the name wrapper —
 * an intermediate element holding neither the headline nor the pictogram.  Both
 * reads are then scoped to a subtree that has neither, so the row ships as
 * `headline: null, engagementType: 'LIKE'` with `extractedCount > 0`, and no
 * tier fires: the originally reported symptom, one level up (#840).
 *
 * Two properties are deliberate.  The row answers to no `li`, so the first try
 * cannot quietly cover for the walk that follows it.  And the name span
 * answers to `span` as well as to `[aria-hidden="true"]`, exactly as a real
 * `<span aria-hidden="true">` does — which is what makes the walk's "not
 * inside the link's own subtree" exclusion load-bearing rather than
 * decorative: without it the name wrapper qualifies as row content on the
 * strength of the name it wraps, and the walk stops one element short.
 */
function nestedRow(opts: {
  slug: string;
  name: string;
  headline: string;
  reaction: string;
}): ElementSpec {
  return {
    sel: "div, [class]",
    children: [
      {
        sel: "div, [class]",
        children: [
          {
            sel: 'a[href*="/in/"], [class]',
            href: `https://www.linkedin.com/in/${opts.slug}/?trk=reactors`,
            children: [{ sel: 'span, [aria-hidden="true"]', text: opts.name }],
          },
        ],
      },
      { sel: "span", text: opts.headline },
      { sel: "img[alt]", attrs: { alt: opts.reaction } },
    ],
  };
}

/**
 * A page whose SDUI filter tab sits shallow enough that the modal walk reaches
 * the document body, with profile links rendered OUTSIDE the modal region.
 *
 * The walk's termination condition is "this ancestor holds engager links", and
 * on a page listing people that is satisfied by every ancestor up to and
 * including `<body>` — a feed behind the modal is enough.  Returning `<body>`
 * scopes the engager scrape to the whole document and reports strangers as
 * reactors, with `extractedCount > 0` so no tier can contradict it (#840).
 *
 * The tab's own subtree deliberately holds NO profile link, so the walk cannot
 * stop early; the only candidate within reach is the body itself.
 */
function shallowSduiPage(sduiCandidate: string): ElementSpec {
  return {
    sel: "body",
    children: [
      { sel: sduiCandidate, text: "1 reactions", height: 20 },
      {
        sel: "section",
        children: [
          {
            sel: 'button[aria-label$=" All reactions"]',
            label: "1 All reactions",
            height: 24,
          },
        ],
      },
      // Somewhere else entirely on the page — a feed, a rail, a search result.
      {
        sel: "div",
        children: [
          {
            sel: 'a[href*="/in/"]',
            href: "https://www.linkedin.com/in/notareactor/",
            children: [{ sel: '[aria-hidden="true"]', text: "Not A Reactor" }],
          },
        ],
      },
    ],
  };
}

/**
 * The legacy reactors modal, as the 2026-09-02 probe measured it.
 *
 * The wrapper answers to every anchor recorded on that one element:
 *
 * ```html
 * <div data-test-modal role="dialog" tabindex="-1"
 *      class="artdeco-modal … social-details-reactors-modal"
 *      aria-labelledby="social-details-reactors-modal__header">
 * ```
 *
 * All four matter and none is decoration.  `.social-details-reactors-modal` is
 * `scopes[0]`; the `aria-labelledby` form is `scopes[1]` and half the `ready`
 * anchor, and a fixture carrying only the class leaves that half exercised by
 * nothing — see `classRenamed` below, which is how it becomes live.
 * `[data-test-modal]` and `[role="dialog"]` are the two anchors this dialect
 * deliberately does NOT bind to, and having them present is what lets a test
 * assert that no adapter resolves through them.
 *
 * **Four tabs, because four is what was measured** — present independently of
 * what the list held, which is the whole finding behind the container tier.  A
 * one-tab fixture flattens to `"ReactionsAll 2"`, and the modal-total's step-2
 * read is UNANCHORED over exactly that flattened text, so a single tab is
 * precisely the shape that cannot surface the over-match risk the source
 * records against itself.
 *
 * Their LABELS were not recorded, and these are not a claim about them: the
 * first carries the measured `"All <N>"` shape and the other three are placed
 * for TEXT SHAPE — a word followed by a count, repeated on both sides of the
 * `All` run — because that is what the unanchored read has to survive.  Their
 * arithmetic is deliberately not reconciled with the `All` count; no assertion
 * reads it, and inventing a consistent split would claim a measurement nobody
 * took.
 *
 * @param opts.rows - Engager rows the list holds.
 * @param opts.tabText - What the "All" tab renders.  The measured page renders
 *   it WITHOUT parentheses.
 * @param opts.classRenamed - Drop `.social-details-reactors-modal`, leaving the
 *   wrapper reachable only through the header it labels.  That is the exact
 *   case `scopes[1]` exists for, per the adapter's own doc.
 * @param opts.scrollable - Give the list region a scrollable box, so the scroll
 *   source has something to find.
 */
function legacyModal(opts: {
  rows: readonly ElementSpec[];
  tabText?: string;
  classRenamed?: boolean;
  scrollable?: boolean;
}): ElementSpec {
  const wrapperAnchors = [
    ...(opts.classRenamed === true ? [] : [".social-details-reactors-modal"]),
    "[data-test-modal]",
    '[role="dialog"]',
    '[aria-labelledby="social-details-reactors-modal__header"]',
  ];
  const list: ElementSpec =
    opts.scrollable === true
      ? {
          sel: "div",
          overflowY: "auto",
          scrollHeight: 2_400,
          clientHeight: 400,
          children: [{ sel: "ul", children: opts.rows }],
        }
      : { sel: "ul", children: opts.rows };
  return {
    sel: wrapperAnchors.join(", "),
    height: 480,
    children: [
      { sel: "h2", text: "Reactions" },
      {
        sel: '[role="tablist"]',
        children: [
          { sel: '[role="tab"]', text: opts.tabText ?? "All 2" },
          { sel: '[role="tab"]', text: "Like 1" },
          { sel: '[role="tab"]', text: "Celebrate 1" },
          { sel: '[role="tab"]', text: "Support 1" },
        ],
      },
      list,
    ],
  };
}

interface EngagerRow {
  firstName: string;
  lastName: string;
  publicId: string | null;
  headline: string | null;
  engagementType: string;
}

describe("reactions-modal adapter registry", () => {
  const adapters = adaptersFor("reactions-modal");
  const [sdui, legacy] = adapters;

  it("registers the known reactions-modal dialects", () => {
    expect(variantNamesFor("reactions-modal")).toEqual([...KNOWN_DOM_VARIANTS]);
  });

  it("has no adapter whose detect anchor or scope is an always-true selector", () => {
    const alwaysTrue = ["main", "body", "html", ":root", "*", "document"];
    for (const adapter of adapters) {
      expect(alwaysTrue).not.toContain(adapter.detect.trim());
      for (const scope of adapter.scopes) {
        expect(alwaysTrue).not.toContain(scope.trim());
      }
      expect(adapter.scopes.length).toBeGreaterThan(0);
    }
  });

  it("binds each adapter's ready anchor to that adapter, not to a shared one", () => {
    // Unlike search results, where a shared hydration anchor is adjudicated
    // and recorded. Here the two dialects' modals have nothing measured in
    // common — one carries a named wrapper, the other carries no wrapper at
    // all — so sharing would be an invented measurement.
    expect(sdui?.ready).not.toBe(legacy?.ready);
  });

  it("stops readiness at the container tier, short of the engager rows", () => {
    // The predicate this replaced asked for at least one engager profile link,
    // which cannot go green on a modal holding nobody — so a zero-reaction post
    // timed out on a modal that had opened perfectly. Readiness now stops where
    // the cardinal tier takes over (ADR-008 § Decision 4).
    for (const adapter of adapters) {
      expect(adapter.ready).not.toContain('a[href*="/in/"]');
    }
  });

  it("polls the measured container-tier anchor, scoped to its own wrapper", () => {
    // POSITIVE, and that is the point. Every readiness test below reads
    // `adapter.ready` out of production and feeds that same string to the
    // double, so it passes by construction whatever `ready` contains: mutate
    // legacy's to `.social-details-reactors-modal .does-not-exist` and all of
    // them stay green, while production polls 10s and raises
    // `ExtractionTimeoutError` on every legacy post — the failure #840 exists
    // to remove. Only a structural assertion can catch that, because the
    // double matches selector strings exactly on comma-split parts, so a
    // descendant combinator can never match a built tree.
    //
    // What is pinned is the MEASURED anchor: four `[role="tab"]` inside a
    // `[role="tablist"]`, present independently of what the list holds.
    expect(legacy?.ready).toContain('[role="tablist"]');
    for (const part of (legacy?.ready ?? "").split(",")) {
      expect(
        (legacy?.scopes ?? []).some((scope) => part.trim().startsWith(scope)),
      ).toBe(true);
    }
    // Every scope gets a readiness branch, so dropping one from either list
    // fails here rather than silently leaving a wrapper shape unpollable.
    expect((legacy?.ready ?? "").split(",")).toHaveLength(
      (legacy?.scopes ?? []).length,
    );

    // SDUI's is pinned to the anchor its own provenance names — the filter
    // tab, the ONE element recorded present on this dialect's open modal
    // (#773). Deliberately NOT a tablist: nothing measured one there, and
    // inventing an anchor for a dialect nobody can probe is the move this file
    // refuses everywhere else.
    expect(sdui?.ready).toBe('button[aria-label$=" All reactions"]');
  });

  it("validates a resolved modal root with the same anchor readiness polls", () => {
    // `rootSignal` is what keeps a scope candidate from being accepted purely
    // for sitting earliest in the document (#840). Tying it to `ready` is not
    // tidiness: readiness asks *has the modal's container rendered* and this
    // asks *is this candidate that container*, so answering them with two
    // different anchors would let a candidate pass one and fail the other.
    expect(legacy?.rootSignal).toBe('[role="tablist"]');
    expect(legacy?.ready).toContain(legacy?.rootSignal ?? "");
    expect(sdui?.rootSignal).toBe(sdui?.ready);
    for (const adapter of adapters) {
      // A signal equal to a scope would be no gate at all — the candidate
      // would validate against itself.
      expect(adapter.scopes).not.toContain(adapter.rootSignal);
    }
  });

  it("confines each dialect's attribute scheme to its own adapter", () => {
    // `[componentkey]` matched 0 document-wide under legacy on 2026-08-31, and
    // `data-reaction-details` is the artdeco-era attribute the SDUI rewrite
    // replaced. Neither can claim the other's dialect, so selection cannot
    // report a false ambiguity.
    expect(sdui?.detect).toContain("componentkey");
    expect(legacy?.detect).not.toContain("componentkey");
    expect(legacy?.detect).toContain("data-reaction-details");
    expect(sdui?.detect).not.toContain("data-reaction-details");
  });
});

describe("reactions-modal readiness predicate", () => {
  const adapters = adaptersFor("reactions-modal");
  const script = buildReadinessPredicateSource(adapters);
  const [sdui, legacy] = adapters;

  it("is false when no adapter claims the page", () => {
    expect(runScript(script, fakeDocument([]))).toBe(false);
  });

  it("is false when the sole claimant's own ready anchor is absent", () => {
    // The trigger is on the page but the modal has not rendered — which is
    // exactly the state between the click and the modal appearing.
    expect(runScript(script, fakeDocument([legacy?.detect ?? ""]))).toBe(false);
  });

  it("is true once the selected dialect's own modal container has rendered", () => {
    expect(
      runScript(
        script,
        fakeDocument([legacy?.detect ?? "", legacy?.ready ?? ""]),
      ),
    ).toBe(true);
  });

  it("is not satisfied by the other dialect's ready anchor", () => {
    expect(
      runScript(script, fakeDocument([legacy?.detect ?? "", sdui?.ready ?? ""])),
    ).toBe(false);
  });

  it("is false when two adapters claim the page, even with a ready anchor present", () => {
    expect(
      runScript(
        script,
        fakeDocument([
          legacy?.detect ?? "",
          sdui?.detect ?? "",
          legacy?.ready ?? "",
        ]),
      ),
    ).toBe(false);
  });
});

describe("reactions trigger", () => {
  const adapters = adaptersFor("reactions-modal");
  const script = buildReactionsTriggerSource(adapters);
  const [sdui] = adapters;
  /** The SDUI dialect's first declared candidate anchor. */
  const sduiCandidate = (sdui?.detect ?? "").split(",")[0]?.trim() ?? "";

  it("matches the affordance LinkedIn actually served, and marks it", () => {
    const page = fakeModalDocument([LEGACY_TRIGGER]);
    expect(runScript(script, page)).toBe(true);

    const doc = page as { querySelector(sel: string): FakeEl | null };
    const marked = doc.querySelector("[data-lhremote-reactions]");
    expect(marked).not.toBeNull();
    // The cardinal rides on the marker so the total read after the click costs
    // no `Runtime.evaluate` of its own.
    expect(marked?.getAttribute("data-lhremote-reactions-total")).toBe("2");
  });

  it("pins the defect: the superseded text-only rule matched nothing here", () => {
    // Not merely "the new rule works" — the point is that the OLD one could
    // not have. Legacy renders the count as a bare "2" with the words only on
    // the control, so a text-only match saw nothing on a post with two
    // reactions and the modal was never opened (#823). The 2026-08-31 probe
    // measured this same pattern matching 0 document-wide.
    const trigger = buildElement(LEGACY_TRIGGER);
    expect(SUPERSEDED_TEXT_ONLY_RULE.test(trigger.textContent)).toBe(false);
    expect(
      SUPERSEDED_TEXT_ONLY_RULE.test(trigger.getAttribute("aria-label") ?? ""),
    ).toBe(true);
  });

  it("reads the count off the text where a dialect renders it there", () => {
    // The other measured half of the same rule: under SDUI the words were the
    // element's own text, which is how the pre-#840 finder worked at all.
    const page = fakeModalDocument([
      { sel: sduiCandidate, text: "24 reactions", height: 20 },
    ]);
    expect(runScript(script, page)).toBe(true);

    const doc = page as { querySelector(sel: string): FakeEl | null };
    expect(
      doc
        .querySelector("[data-lhremote-reactions]")
        ?.getAttribute("data-lhremote-reactions-total"),
    ).toBe("24");
  });

  it("returns false rather than raising when no adapter claims the page", () => {
    // THE DISPOSITION OF THE HELD TEST (`get-post-engagers.test.ts:199`,
    // pending spike #830): CONFIRM, not invert. On post detail and search
    // results a zero-detect page raises `DOMVariantUnsupportedError`; here it
    // must not, because a post with no reactions renders no affordance and
    // raising would throw on ordinary posts. `false` is what the operation
    // turns into an empty list.
    expect(runScript(script, fakeModalDocument([]))).toBe(false);
  });

  it("returns false when the dialect is present but renders no affordance", () => {
    // The same benign answer one step later: SDUI claims every post-detail
    // page, so a zero-reaction post reaches the scan and finds nothing.
    const page = fakeModalDocument([
      { sel: sduiCandidate, text: "Like", height: 20 },
    ]);
    expect(runScript(script, page)).toBe(false);
  });

  it("skips a candidate that is not visible", () => {
    // Height defaults to 0 in a fixture, which is the same thing an offscreen
    // or collapsed control reports. Clicking one opens nothing.
    const page = fakeModalDocument([{ ...LEGACY_TRIGGER, height: 0 }]);
    expect(runScript(script, page)).toBe(false);
  });

  it("reports the claimants when two adapters match, instead of picking one", () => {
    // A hybrid page: the two dialects put the trigger in different places, so
    // clicking one dialect's affordance opens a modal nothing is bound to read.
    const page = fakeModalDocument([LEGACY_TRIGGER], [sduiCandidate]);
    expect(runScript(script, page)).toEqual({
      ambiguousVariants: [...KNOWN_DOM_VARIANTS],
    });
  });

  it("never decides a branch by the ABSENCE of a variant-specific attribute", () => {
    expect(script).not.toMatch(/!\s*document\.querySelector/);
  });
});

describe("reactions-modal total", () => {
  const adapters = adaptersFor("reactions-modal");
  const script = buildReactionsModalTotalSource(adapters);
  const triggerScript = buildReactionsTriggerSource(adapters);

  it('accepts "All 2" WITHOUT parentheses', () => {
    // The defect, pinned: the read this replaces required `All (2)` and legacy
    // renders `All 2`, so it returned 0 with the modal open and two engagers
    // inside it — a contradiction pointing the opposite way from #823, and one
    // that would have made a real contradiction look corroborated.
    const page = fakeModalDocument([
      // The trigger stays in every post-click fixture, and that is the
      // surface's design rather than fixture noise: `detect` IS the trigger,
      // so a page that lost it after the click would select no adapter and
      // nothing downstream could resolve the modal it just opened.
      LEGACY_TRIGGER,
      legacyModal({ rows: [], tabText: "All 2" }),
    ]);
    expect(runScript(script, page)).toBe(2);
  });

  it('still accepts "All (2)"', () => {
    const page = fakeModalDocument([
      LEGACY_TRIGGER,
      legacyModal({ rows: [], tabText: "All (2)" }),
    ]);
    expect(runScript(script, page)).toBe(2);
  });

  it("prefers the cardinal stamped on the trigger before the click", () => {
    // The whole point of stamping: the trigger's accessible name IS the count,
    // where the modal's own text is prose that happens to contain one. The tab
    // below disagrees on purpose, so a pass cannot come from both agreeing.
    const page = fakeModalDocument([
      LEGACY_TRIGGER,
      legacyModal({ rows: [], tabText: "All 99" }),
    ]);
    expect(runScript(triggerScript, page)).toBe(true);
    expect(runScript(script, page)).toBe(2);
  });

  it("reads the All tab out of the measured FOUR-tab flattened text", () => {
    // The step-2 read is unanchored: it flattens the whole modal and pattern-
    // matches. Against the measured wrapper that flattened text is
    // "ReactionsAll 2Like 1Celebrate 1Support 1" — three further count-bearing
    // runs after the one being read, and the h2 fused to the front of it. A
    // one-tab fixture ("ReactionsAll 2") cannot show that the read survives
    // them, which is exactly the over-match risk the source records against
    // itself (#840).
    const modal = legacyModal({ rows: [] });
    expect(specText(modal)).toBe("ReactionsAll 2Like 1Celebrate 1Support 1");
    expect(runScript(script, fakeModalDocument([LEGACY_TRIGGER, modal]))).toBe(
      2,
    );
  });

  it("returns 0 when nothing can be read", () => {
    // The value that keeps an empty scrape LEGAL. Inventing a positive
    // cardinal from a failed read would raise on a page nobody has looked at.
    expect(runScript(script, fakeModalDocument([]))).toBe(0);
  });
});

describe("reactions-modal extraction", () => {
  const adapters = adaptersFor("reactions-modal");
  const script = buildReactionsModalExtractionSource(adapters);
  const [sdui, legacy] = adapters;
  const sduiCandidate = (sdui?.detect ?? "").split(",")[0]?.trim() ?? "";

  const ROW = engagerRow({
    slug: "janedoe",
    name: "Jane Doe",
    headline: "Software Engineer at ACME",
    reaction: "celebrate",
  });

  it("returns null when no adapter claims the page", () => {
    expect(runScript(script, fakeModalDocument([]))).toBeNull();
  });

  it("returns null when the claiming adapter resolves no modal root", () => {
    // THE CONTAINER TIER. The trigger is on the page, so an adapter is
    // selected, but nothing this dialect knows resolves the modal. That is
    // "the region was not read" — which the operation raises on — and it is
    // categorically different from the empty array below.
    expect(runScript(script, fakeModalDocument([LEGACY_TRIGGER]))).toBeNull();
  });

  it("returns an EMPTY ARRAY for a container that resolved with no rows", () => {
    // The other half of the contract, and the half the code this replaces
    // could not express: `scraped ?? []` turned the `null` above into this.
    // Container present, zero rows — genuinely zero, and the cardinal tier
    // decides what it means.
    const page = fakeModalDocument([LEGACY_TRIGGER, legacyModal({ rows: [] })]);
    expect(runScript(script, page)).toEqual([]);
  });

  it("extracts engager rows under the legacy dialect", () => {
    const page = fakeModalDocument([
      LEGACY_TRIGGER,
      legacyModal({ rows: [ROW] }),
    ]);
    const rows = runScript(script, page) as EngagerRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      firstName: "Jane",
      lastName: "Doe",
      publicId: "janedoe",
      // Not "Connect": that affordance label clears the headline rule's
      // five-character floor, so it is rejected by name (#840).
      headline: "Software Engineer at ACME",
      engagementType: "PRAISE",
    });
  });

  it("de-duplicates the rows a single engager renders more than one link for", () => {
    const page = fakeModalDocument([
      LEGACY_TRIGGER,
      legacyModal({ rows: [ROW, ROW] }),
    ]);
    expect(runScript(script, page)).toHaveLength(1);
  });

  it("keeps the de-dup slot for the anchor that actually carries a name", () => {
    // An actor lockup renders the avatar anchor BEFORE the name-bearing one at
    // the same href. Recording the href before the unusable-name reject lets
    // the avatar consume the slot and skips the readable sibling — one row in,
    // zero engagers out, next to a positive stamped total (#840).
    const page = fakeModalDocument([
      LEGACY_TRIGGER,
      legacyModal({
        rows: [
          actorLockupRow({
            slug: "janedoe",
            name: "Jane Doe",
            headline: "Software Engineer at ACME",
            reaction: "celebrate",
          }),
        ],
      }),
    ]);
    const rows = runScript(script, page) as EngagerRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ firstName: "Jane", publicId: "janedoe" });
    // Still de-duplicated: one PERSON, not one anchor. The reject moved, the
    // de-dup did not go away.
    expect(rows.filter((row) => row.publicId === "janedoe")).toHaveLength(1);
  });

  it("reads the row from the link's PARENT on a dialect that renders no <li>", () => {
    // `closest` includes the element it is called on, and the anchor carries a
    // class, so walking from the link returns the link — and the headline and
    // pictogram scans then run over the anchor's own subtree, where neither
    // exists. The failure is silent: `extractedCount > 0`, so no tier fires.
    const page = fakeModalDocument([
      LEGACY_TRIGGER,
      legacyModal({
        rows: [
          classRow({
            slug: "janedoe",
            name: "Jane Doe",
            headline: "Software Engineer at ACME",
            reaction: "celebrate",
          }),
        ],
      }),
    ]);
    const rows = runScript(script, page) as EngagerRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      firstName: "Jane",
      // Both of these are what the link's own subtree cannot supply.
      headline: "Software Engineer at ACME",
      engagementType: "PRAISE",
    });
  });

  it("reads the row from the ancestor that holds row content, not from a wrapper between it and the link", () => {
    // One level deeper than the case above, which is all it takes: walking
    // from the parent lands on `div.name-wrapper`, and `closest('[class]')`
    // accepts it because it carries a class — not because it is the row. The
    // headline and pictogram scans then run over a subtree holding neither,
    // and the row ships `headline: null` with the `'LIKE'` default and
    // `extractedCount > 0`, so nothing raises (#840).
    const page = fakeModalDocument([
      LEGACY_TRIGGER,
      legacyModal({
        rows: [
          nestedRow({
            slug: "janedoe",
            name: "Jane Doe",
            headline: "Software Engineer at ACME",
            reaction: "celebrate",
          }),
        ],
      }),
    ]);
    const rows = runScript(script, page) as EngagerRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      firstName: "Jane",
      // Both read from the ROW, two levels above the anchor.
      headline: "Software Engineer at ACME",
      engagementType: "PRAISE",
    });
  });

  it("resolves the modal through the aria-labelledby anchor when the class is renamed", () => {
    // `scopes[1]` is the case the adapter's own doc describes as becoming live
    // "only if the class is renamed", and until this fixture existed nothing
    // exercised it — nor the half of the `ready` anchor built on it.
    const page = fakeModalDocument([
      LEGACY_TRIGGER,
      legacyModal({ rows: [ROW], classRenamed: true }),
    ]);
    const rows = runScript(script, page) as EngagerRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.publicId).toBe("janedoe");
  });

  it("refuses an unrelated overlay that matches a scope but holds no modal", () => {
    // The SDUI scopes are the generic `dialog` / `[aria-modal="true"]`, and a
    // CLOSED <dialog> still matches `querySelector('dialog')`. Taking the
    // first hit returns a cookie banner or a messaging overlay as "the modal":
    // with no engager rows it scrapes to `[]` and the cardinal tier raises on
    // a modal that opened perfectly, and WITH `/in/` links it returns people
    // who never reacted, `extractedCount > 0`, nothing raised (#840).
    const overlay: ElementSpec = {
      sel: "dialog",
      height: 200,
      children: [
        {
          sel: 'a[href*="/in/"]',
          href: "https://www.linkedin.com/in/notareactor/",
          children: [{ sel: '[aria-hidden="true"]', text: "Not A Reactor" }],
        },
      ],
    };
    const host: ElementSpec = {
      sel: "section",
      height: 480,
      children: [
        {
          sel: 'button[aria-label$=" All reactions"]',
          label: "1 All reactions",
          height: 24,
        },
        { sel: "ul", children: [ROW] },
      ],
    };
    const page = fakeModalDocument(
      [
        { sel: sduiCandidate, text: "1 reactions", height: 20 },
        // Earlier in document order than the real modal, which is the whole
        // hazard: precedence by position rather than by evidence.
        overlay,
        host,
      ],
      [],
    );
    const rows = runScript(script, page) as EngagerRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.publicId).toBe("janedoe");
  });

  it("resolves an SDUI modal that carries no wrapper at all, by walking up", () => {
    // #773's measured state: zero canonical wrappers on a page where the modal
    // was visibly open. The walk from the filter tab is this dialect's ONLY
    // resolution, which is why it survives as the adapter's own resolver
    // rather than as a shared fallback.
    const host: ElementSpec = {
      sel: "div",
      height: 480,
      children: [
        {
          sel: 'button[aria-label$=" All reactions"]',
          label: "1 All reactions",
          height: 24,
        },
        { sel: "ul", children: [ROW] },
      ],
    };
    const page = fakeModalDocument(
      [{ sel: sduiCandidate, text: "1 reactions", height: 20 }, host],
      [],
    );
    const rows = runScript(script, page) as EngagerRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.publicId).toBe("janedoe");
  });

  it("refuses to resolve the document body, even though it holds engager links", () => {
    // The SDUI walk stops on "this ancestor holds engager links", and that is
    // NOT a validation: on a page listing people anywhere — a feed behind the
    // modal, a rail, a search result — every ancestor up to `<body>` satisfies
    // it. Returning the body scopes the scrape to the whole document and
    // reports strangers as reactors, with `extractedCount > 0` so no tier can
    // contradict it. `null` is the correct answer: the caller raises, which is
    // loud, where the alternative ships wrong data quietly (#840).
    const page = fakeModalDocument([shallowSduiPage(sduiCandidate)]);

    expect(runScript(script, page)).toBeNull();
  });

  it("reports the claimants when two adapters match, instead of picking one", () => {
    const page = fakeModalDocument(
      [LEGACY_TRIGGER, legacyModal({ rows: [ROW] })],
      [sduiCandidate],
    );
    expect(runScript(script, page)).toEqual({
      ambiguousVariants: [...KNOWN_DOM_VARIANTS],
    });
  });

  it("reads no page-wide text at all", () => {
    expect(script).not.toContain("document.body");
  });

  it("keeps the legacy dialect's anchors out of the SDUI adapter's resolver", () => {
    expect(legacy?.extract).not.toContain("All reactions");
    expect(sdui?.extract).toContain("All reactions");
  });
});

describe("reactions-modal scroll", () => {
  const adapters = adaptersFor("reactions-modal");
  const script = buildReactionsModalScrollSource(adapters, 500);
  const [sdui] = adapters;
  const sduiCandidate = (sdui?.detect ?? "").split(",")[0]?.trim() ?? "";

  it("reports UNRESOLVED, not the bottom, when no adapter resolves the modal", () => {
    // This used to answer `false`, the same value it returns for a list that
    // did not move — and the collect loop reads that as *reached the bottom*
    // and breaks. So a modal re-rendering into an unresolvable state
    // mid-collection was swallowed: rows scraped before the re-render make
    // `extractedCount` positive, the cardinal tier stays quiet, and the call
    // returns a truncated list with no error, while the extraction source
    // reports the SAME condition as `null` and the caller raises on it (#840).
    //
    // `null` here is what lets the caller tell the two apart. `false` keeps
    // its meaning, and the two tests below still assert it.
    expect(runScript(script, fakeModalDocument([]))).toBeNull();
  });

  it("reports the claimants when two adapters match, instead of picking one", () => {
    // A hybrid page refuses in its own shape rather than as a bottom, for the
    // same reason: the caller raises `DOMVariantAmbiguousError` on it, exactly
    // as it does for the scrape.
    const page = fakeModalDocument(
      [LEGACY_TRIGGER, legacyModal({ rows: [], scrollable: true })],
      [sduiCandidate],
    );
    expect(runScript(script, page)).toEqual({
      ambiguousVariants: [...KNOWN_DOM_VARIANTS],
    });
  });

  it("resolves the modal through the registry, not a hand-written chain", () => {
    expect(script).toContain("__lhReactionsModalRoot");
    expect(script).toContain(JSON.stringify(".social-details-reactors-modal"));
    expect(script).toContain("scrollTop += 500");
  });

  // The three tests below EXECUTE the scroll. Until the double grew a
  // `scrollTop` and the harness a `getComputedStyle` shim, it structurally
  // could not: the emitted body calls a global that is not in scope inside
  // `new Function("document", ...)` and writes a property `FakeEl` did not
  // declare — so the only coverage was the never-reaches-it `false` path plus
  // three source greps, and `dom-variant.integration.test.ts` uses only
  // `adaptersFor("post-detail")`, leaving this surface no real-browser tier at
  // all (#840).
  //
  // What that permits is silent: a source that always returns `false` — wrong
  // `scrollable` chosen, inverted `overflowY` test, `scrollTop` written on the
  // wrong node — stops the collect loop after the first scrape. The operation
  // then returns the first screen of engagers while `paging.total` reports the
  // whole modal, and the cardinal tier stays quiet because `extractedCount`
  // is positive. HTTP success, no error, under-collection on every post with
  // more engagers than fit one screen.
  //
  // `scrollTop` is CLAMPED here as a browser clamps it, which is what makes
  // these falsifiable rather than three ways of observing `+= 500`.

  it("advances the list and reports that it moved", () => {
    const page = fakeModalDocument([
      LEGACY_TRIGGER,
      legacyModal({ rows: [], scrollable: true }),
    ]);
    expect(runScript(script, page)).toBe(true);

    const doc = page as { querySelector(sel: string): FakeEl | null };
    // Written on the SCROLLABLE region, not on the modal it lives in. The
    // wrapper is not a scroll box, so a source that wrote there would move
    // nothing and report `false` — which is the same observation as "we have
    // reached the bottom".
    expect(doc.querySelector("div")?.scrollTop).toBe(500);
    expect(
      doc.querySelector(".social-details-reactors-modal")?.scrollTop,
    ).toBe(0);
  });

  it("declines once the region has reached its bottom", () => {
    // A second scroll past the ceiling: the clamp holds `scrollTop`, so the
    // source sees no movement and declines — which is exactly how the collect
    // loop learns to stop, and it must not be an error.
    const page = fakeModalDocument([
      LEGACY_TRIGGER,
      legacyModal({ rows: [], scrollable: true }),
    ]);
    for (let i = 0; i < 4; i++) runScript(script, page);
    expect(runScript(script, page)).toBe(false);
  });

  it("does not take a region that overflows without scrolling", () => {
    // `overflow-y: visible` with content taller than the box is not a scroll
    // container. Choosing it — an inverted `overflowY` test — would write into
    // an element that cannot move, so the source must fall through to the
    // modal instead, which also cannot move, and decline.
    const page = fakeModalDocument([
      LEGACY_TRIGGER,
      {
        sel: ".social-details-reactors-modal",
        height: 480,
        children: [
          { sel: '[role="tablist"]', children: [{ sel: '[role="tab"]' }] },
          {
            sel: "div",
            overflowY: "visible",
            scrollHeight: 2_400,
            clientHeight: 400,
            children: [{ sel: "ul" }],
          },
        ],
      },
    ]);
    expect(runScript(script, page)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// reactions-modal :: the TS→JS seam (#840)
// ───────────────────────────────────────────────────────────────────────────
//
// Everything inside these template literals is JavaScript inside a JavaScript
// STRING, and nothing in the type system notices when that goes wrong.  A
// hand-quoted `'${SELECTOR}'` is valid TypeScript, compiles, lints, and emits
// either a syntax error the caller's `.catch` swallows or — worse — a
// valid-but-DIFFERENT selector that silently matches nothing.  Round 1 fixed
// seven such sites in `wait-for-reactions-modal.ts`; nothing stopped an eighth
// from being written, which is what this block is for.
describe("reactions-modal emitted-source escaping", () => {
  const adapters = adaptersFor("reactions-modal");

  /** Every source this surface emits, by the name a failure should print. */
  const sources: Readonly<Record<string, string>> = {
    trigger: buildReactionsTriggerSource(adapters),
    total: buildReactionsModalTotalSource(adapters),
    extraction: buildReactionsModalExtractionSource(adapters),
    // `gaussianBetween` is randomised at the call site, so a distance is
    // supplied here; the source shape is what is under test, not the number.
    scroll: buildReactionsModalScrollSource(adapters, 500),
    readiness: buildReadinessPredicateSource(adapters),
    detection: buildDetectionSource(adapters),
  };

  /**
   * The selectors these sources INTERPOLATE — the ones a hand-quoting
   * regression can reach.  Adapter anchors come from the registry rather than
   * being restated, so registering a fourth dialect extends this set without
   * an edit here.  The three bare literals below are module constants with no
   * public accessor; they are written out because the alternative is exporting
   * them purely to be asserted on.
   */
  const interpolated: readonly string[] = [
    ...adapters.flatMap((adapter) => [
      adapter.detect,
      adapter.ready,
      ...adapter.scopes,
      adapter.rootSignal,
    ]),
    // REACTIONS_MODAL_ENGAGER_LINK — the row anchor and the SDUI walk's target.
    'a[href*="/in/"]',
    // REACTIONS_MODAL_ROW_CONTENT — the row walk's accept signal.
    "p, span, img[alt]",
    // REACTIONS_MODAL_FORBIDDEN_SCOPE — what the walk refuses to return.
    "body, html, head, main",
  ];

  /**
   * Every double-quoted string literal in an emitted source, decoded.
   *
   * A plain `toContain(JSON.stringify(sel))` cannot express the property,
   * because several anchors are SUBSTRINGS of a composite one: legacy's
   * `ready` is `.social-details-reactors-modal [role="tablist"]`, so the
   * wrapper anchor appears — correctly, inside a JSON literal — in sources
   * that never interpolate it on its own.  Decoding the literals asks the
   * question that actually matters: did this selector reach the source THROUGH
   * a JSON literal, whatever literal that was?
   *
   * Unparseable matches are skipped rather than failing: the regex also picks
   * up the double quotes INSIDE a single-quoted selector (`'[aria-hidden=
   * "true"]'`), which is not a literal boundary and not what is under test.
   */
  function jsonLiteralsIn(source: string): string[] {
    return (source.match(/"(?:[^"\\\n]|\\.)*"/g) ?? []).flatMap((raw) => {
      try {
        return [JSON.parse(raw) as string];
      } catch {
        return [];
      }
    });
  }

  it("carries every interpolated selector as a JSON string literal", () => {
    for (const [name, source] of Object.entries(sources)) {
      const decoded = jsonLiteralsIn(source);
      for (const selector of interpolated) {
        if (!source.includes(selector)) continue;
        expect(
          decoded.some((literal) => literal.includes(selector)),
          `${name} carries ${selector} outside any JSON string literal`,
        ).toBe(true);
      }
    }
  });

  it("hand-quotes none of them", () => {
    // The direct inverse, and not redundant with the check above: a source can
    // carry BOTH forms — one site fixed, a second added — and the containment
    // assertion alone would pass.
    for (const [name, source] of Object.entries(sources)) {
      for (const selector of interpolated) {
        expect(source, `${name} hand-quotes ${selector}`).not.toContain(
          `'${selector}'`,
        );
      }
    }
  });

  it("emits sources that parse", () => {
    // The seam's failure mode is a source that is not JavaScript at all, and
    // every suite above runs these through `new Function` only for the fixture
    // it happens to exercise. This asserts the property directly, for every
    // emitted source, including the ones no fixture reaches.
    for (const [name, source] of Object.entries(sources)) {
      expect(() => new Function(source), `${name} does not parse`).not.toThrow();
    }
  });
});
