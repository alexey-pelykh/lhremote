// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { CDPClient } from "../../cdp/client.js";
import {
  launchChromium,
  type ChromiumInstance,
} from "../../cdp/testing/launch-chromium.js";
import { jsString } from "../../utils/js-string.js";
import { assertCardinalCorroboration } from "../corroboration.js";
import {
  adaptersFor,
  buildDetectionSource,
  buildReadinessPredicateSource,
  buildSearchResultsExtractionSource,
  variantNamesFor,
} from "../dom-variant.js";

/** Timeout for beforeEach operations (connect) on slow CI runners. */
const BEFORE_EACH_TIMEOUT = 15_000;

/**
 * The Tier-2 oracle for the `search-results` surface.
 *
 * Before this file the surface had **no integration-tier coverage at all**
 * (#868).  Per ADR-004 the Tier-3 E2E suite never runs in CI, so Tier 2 is
 * the only tier that can gate a DOM variant flip on this surface before
 * merge; every claim about it previously rested on Tier 1 against a
 * hand-rolled stand-in for `document`.
 *
 * ## What this grades, and why each part is real evidence
 *
 * Three classes, and the boundary between them is the whole design:
 *
 * 1. **Selection** — which adapter claims a page, what happens when none or
 *    several do, and the readiness conjunction.  This is the same thing
 *    `dom-variant.integration.test.ts` does for post detail, against DOM
 *    built here rather than harvested, and it is evidence because the
 *    verdict comes from real `querySelectorAll` semantics rather than from
 *    a stand-in.
 * 2. **Reads only a real browser can settle** — chiefly how sibling
 *    elements' text concatenates under `Element.textContent`, which is what
 *    #869 turns on.  The browser performs the concatenation; this file only
 *    renders two adjacent elements and reads what came back.  Nothing here
 *    is authored to produce the answer.
 * 3. **The shared card loop** in `buildSearchResultsExtractionSource` —
 *    enumeration, the height floor, the menu-button filter, the author name
 *    parsed out of that button's `aria-label`, the profile URL, the media
 *    type, `postCardCount`, and the three engagement counters.  This half is
 *    shared by BOTH dialects, and its anchors are the ones with live
 *    measurements behind them (see `SEARCH_RESULT_MENU_BUTTON`'s adjudication
 *    in `dom-variant.ts`: measured on the pre-SDUI feed 2026-03-27 and on the
 *    post-flip search page 2026-04-15).
 *
 * ## What this deliberately does NOT grade — the residual of #868
 *
 * Two omissions, and the first is the point rather than an oversight.
 *
 * **The three `adapter.extract` fields.** `authorHeadline`, `text` and
 * `timestamp` are **not asserted for either dialect**.
 *
 * The `legacy` search-results extractor is RECONSTRUCTED, not measured: no
 * live legacy probe of a search-results page exists, and `dom-variant.ts`
 * says so at the constant.  Markup written here to exercise those selectors
 * would be written *from the same reconstruction*, so asserting the values
 * it yields would grade the reconstruction against itself — a tautology that
 * cannot witness a variant flip, which is the only thing such an assertion
 * would be for.  `__fixtures__/README.md` § "Not captured, and why" already
 * takes that disposition twice for post detail; this is the same call on the
 * same grounds.
 *
 * Closing that half needs a real captured page, and one could not be taken
 * here: `scripts/harvest-dom-fixture.mjs` is post-detail-bound, a capture
 * taken today would most likely be **sdui** (this surface last measured sdui
 * on 2026-04-15) and so would not measure the dialect #868 names, and a
 * search-results page carries many third parties' content into a public repo
 * behind a scrub shaped for a different surface.  So #868's first gap — "no
 * Tier-2 coverage at all" — is closed here, and its second — "the legacy
 * adapter has never been probed" — is narrowed to those three fields and
 * stays open.
 *
 * **The `mediaType` image branch.** Only the `video` branch is asserted.  The
 * image branch keys on `img[src*="media.licdn.com"]` plus an `offsetHeight`
 * filter, and a matching `src` would be a live fetch — this suite runs with
 * no network, the same property the harvested fixtures are scrubbed to
 * preserve.  So where the list above says this file grades "the media type",
 * read that as the video branch: the image branch's own layout read is a
 * second thing this tier could uniquely settle, and does not.
 *
 * ## Why there is no `.measured.json` sidecar
 *
 * The post-detail oracle grades installed DOM against a sidecar recording
 * what was measured on the live page *before scrubbing*; a disagreement is a
 * finding about the capture rather than a number to adjust.  That file is
 * provenance, and provenance is exactly what a built page has none of.
 * Writing the structure this file builds into a JSON file beside it would
 * dress a declaration up as a measurement — the same author on both sides of
 * the comparison — so the structural spec each page is graded against is
 * declared HERE, in {@link PAGES}, and graded with literal selectors.
 *
 * ## The canary, and why it is not tidiness
 *
 * `it.fails` passes whenever its body fails **for any reason**, so a page
 * that never installed would make every tripwire below green while testing
 * nothing — the degenerate gate wearing the costume of the fix for it.  Every
 * `it.fails` block here therefore has a plain-`it` canary outside it, and the
 * canaries carry two distinct claims because a single one would not cover the
 * hazard: that the DOM *installed* (structure, literal selectors), and that
 * the extraction *produced a post at all* (`postCardCount`, `posts.length`).
 *
 * The second matters for a reason worth stating precisely, because the
 * obvious version of it is wrong: a tripwire reading
 * `record?.posts?.[0]?.commentCount` against an empty array does **not**
 * throw — `[][0]` is `undefined`, and the optional chain short-circuits
 * rather than dereferencing.  It is the *comparison* that then fails,
 * `expect(undefined).toBe(41)`, which turns the `it.fails` block green while
 * measuring nothing about the count it names.  Same outcome, different
 * mechanism; a maintainer who checks the throw claim, finds no throw, and
 * concludes the canary guards nothing would re-open exactly this hazard.
 *
 * The canaries use literal selectors hand-written in this file rather than
 * the adapters' own constants, for the reason `dom-variant.integration.test.ts`
 * states at `LEGACY_CONTAINER`: deriving the check from the anchor under test
 * makes it assert against markup authored from that anchor.  Written out, a
 * canary stays green under a selector regression and goes red under an
 * infrastructure fault, which is the discrimination it exists to provide.
 */

/** The document shell.  The doctype is a standing guard — see {@link install}. */
function shell(body: string): string {
  return `<!doctype html><html><head></head><body>${body}</body></html>`;
}

/**
 * A card's engagement row rendered as ADJACENT SIBLING ELEMENTS, with the
 * reaction count LABELLED — the shape #869 turns on, and the shape LinkedIn
 * actually serves.
 *
 * Two things are happening at once, and both are load-bearing:
 *
 * 1. **The join.** Under `Element.textContent` adjacent element text nodes
 *    concatenate with no separator, so `2` beside `41 comments` reads as
 *    `241 comments`.  The browser performs that join; this file only renders
 *    the two elements.
 * 2. **The label.** LinkedIn renders a reaction count as a bare number and
 *    puts the words on the control — `2`, labelled `2 reactions` — which
 *    `dom-variant.ts` records verbatim at `__lhReadCount` as the reason that
 *    read consults `aria-label` before text.  The `aria-label` here is
 *    therefore not decoration: it is the only place the word "reactions"
 *    appears, so a text-only read finds no reaction count at all while an
 *    anchored read recovers `2`.
 *
 * Omitting that label would make this fixture unfixable rather than merely
 * broken: with no "reactions" token anywhere, `0` is the correct answer both
 * before and after #869 (see {@link UNLABELLED_SPLIT_COUNTS_ROW}), so a
 * tripwire demanding `2` from it could never flip and would sit green
 * forever — the degenerate gate this file exists to prevent, arriving through
 * the opposite door.
 */
const LABELLED_SPLIT_COUNTS_ROW = `<div><button aria-label="2 reactions"><span>2</span></button><span>41 comments</span></div>`;

/**
 * The same split shape with the label REMOVED — a bare `2` carrying no
 * "reactions" token anywhere, in the text or on a control.
 *
 * This is a different claim from the row above, and the corpus has settled
 * the PRINCIPLE, though not on this exact markup: `dom-variant.integration
 * .test.ts` pins `reactionCount: 0` for a post-detail row rendering both
 * counters as ONE node ("2 41 comments"), reasoning that "0 reactions is the
 * honest answer, not a miss: this rendering carries no 'reactions' token
 * anywhere for a read to find."  That row has a separator and one text node;
 * this one has neither, so the reasoning transfers but the rendering does
 * not — see {@link ONE_NODE_COUNTS_ROW}, which carries the one-node shape.
 *
 * So this row's reaction count is 0 **before and after** #869, and asserting
 * anything else would demand a positional guess — "the leading bare number in
 * a counts row is the reaction count" — which is precisely the always-true
 * anchor ADR-008 § Decision 3 removed.  Its comment count is still wrong
 * today, and that half IS a tripwire.
 */
const UNLABELLED_SPLIT_COUNTS_ROW = `<div><span>2</span><span>41 comments</span></div>`;

/**
 * Both counters as ONE text node WITH a separator — `2 41 comments`.
 *
 * The shape neither split row covers, and the one that discriminates a
 * property of the #869 fix nothing else here can see.  The pre-#869 whole-card
 * text read already answered it CORRECTLY (41 comments, 0 reactions), so this
 * was a passing CONTROL rather than a tripwire, and it stays one.
 *
 * What it guards: the anchored read finds each counter by matching an ELEMENT
 * against `^<N> comments$`, and no element here matches — the div's text is
 * the whole phrase.  That read only recovers 41 by falling back to a loose
 * scan, and the fallback is gated on having narrowed to a counts root first.
 * A search-results adapter declares no counts anchor, so porting the anchored
 * read without giving this surface something to narrow TO would never narrow,
 * never reach the fallback, and return 0 for this row — a regression the
 * pre-#869 code did not have, in a shape the split rows cannot expose because
 * both of theirs do match per element.
 *
 * That is the trap this row was written to set, and the fix answers it by
 * handing `__lhReadCount` the CARD as an already-narrowed root: enumeration
 * has reduced the page to one post before the counters are read, so the loose
 * scan stays reachable while remaining scoped to a single card.  Which is why
 * this row keeps its value as a control — it is the only assertion here that
 * would go red if that narrowing were dropped.
 */
const ONE_NODE_COUNTS_ROW = `<div>2 41 comments</div>`;

/** The same two numbers rendered as whole phrases — the control. */
const WHOLE_COUNTS_ROW = `<div><span>2 reactions</span> <span>41 comments</span></div>`;

/**
 * A whole-phrase row that also renders reposts — the control that witnesses a
 * NON-ZERO `shareCount`.
 *
 * Without it every green assertion about `shareCount` in this file expects
 * `0`, and a #869 fix that silently zeroed the repost counter would satisfy
 * all of them while turning the split-reposts tripwire green for the wrong
 * reason.
 */
const WHOLE_REPOSTS_ROW = `<div><span>2 reactions</span> <span>41 comments</span> <span>3 reposts</span></div>`;

/** The repost counter under the same split-sibling shape: `7` beside `3 reposts`. */
const SPLIT_REPOSTS_ROW = `<div><span>7</span><span>3 reposts</span></div>`;

/**
 * A `legacy` search-result card.
 *
 * Carries the chameleon result container (this dialect's `detect` anchor and
 * `scopes[0]`), the shared card skeleton — `role="listitem"`, the control
 * menu button whose label carries the author name, and an author link — and
 * whatever counts row the caller asks for.
 *
 * The inline height is not a claim about LinkedIn.  The shared card loop
 * skips any card under 100 px, `offsetHeight` needs layout, and a fixture
 * carries no CSS, so the height is stated explicitly to put each card on a
 * known side of that floor rather than at the mercy of content flow.
 */
function legacyCard(
  opts: {
    urn?: string;
    name?: string;
    counts?: string;
    height?: number;
    menuButton?: boolean;
    extra?: string;
  } = {},
): string {
  const name = opts.name ?? "Test Person";
  const menu = opts.menuButton ?? true;
  return `<div role="listitem" data-chameleon-result-urn="${opts.urn ?? "urn:li:activity:7436698865522851840"}" style="height:${String(opts.height ?? 300)}px">
  <a href="https://www.linkedin.com/in/test-person-1/"><figure></figure></a>
  ${menu ? `<button aria-label="Open control menu for post by ${name}"></button>` : ""}
  <span dir="ltr">A post body comfortably longer than twenty characters.</span>
  ${opts.counts ?? ""}
  ${opts.extra ?? ""}
</div>`;
}

/**
 * An `sdui` search-result card — the expandable text box inside a listitem,
 * which is this dialect's `detect` anchor.
 */
function sduiCard(opts: { counts?: string; height?: number } = {}): string {
  return `<div role="listitem" style="height:${String(opts.height ?? 300)}px">
  <a href="https://www.linkedin.com/in/test-person-2/"><figure></figure></a>
  <a href="https://www.linkedin.com/in/test-person-2/"><p>Test Person</p><p>1st</p><p>A headline</p><p>18h •</p></a>
  <button aria-label="Open control menu for post by Test Person"></button>
  <div data-testid="expandable-text-box">A post body comfortably longer than twenty characters.<button data-testid="expandable-text-button">…more</button></div>
  ${opts.counts ?? ""}
</div>`;
}

/**
 * What a built page structurally carries, graded by the canary with literal
 * selectors.
 *
 * This is the built-page counterpart of the post-detail oracle's
 * `.measured.json`, and it is deliberately weaker: it records what this file
 * BUILDS, not what was measured on a live page.  It exists to tell "the page
 * never installed" apart from "an adapter no longer claims it", which is the
 * one job a canary has.
 */
interface PageSpec {
  /** `div[role="listitem"]` elements on the page. */
  readonly listitems: number;
  /** `[data-chameleon-result-urn]` elements — the legacy detect anchor. */
  readonly chameleonContainers: number;
  /** `[data-testid="expandable-text-box"]` elements, anywhere on the page. */
  readonly textBoxes: number;
  /** `button[aria-label^="Open control menu for post"]` elements, anywhere. */
  readonly menuButtons: number;
  /**
   * `main h1` elements — the empty-state heading a zero-result search renders.
   *
   * Every other field on this interface counts a CARD anchor, so all of them
   * go to zero on the zero-result page, whose whole point is that it renders
   * no cards.  A spec of all zeros is satisfied by a BLANK document, which
   * would leave that page's canary unable to tell "the zero-result page
   * installed" from "nothing installed at all" — the one distinction a canary
   * exists to make, and the one the assertions pinning the ADR-008 ambiguity
   * lean on.  So this field gives that page a POSITIVE claim of its own.
   *
   * It counts the page's own content rather than `body > *`, which was tried
   * first and is the wrong instrument: a whole-document structural invariant
   * asserts that nothing ELSE is on the page, which is a claim about the
   * harness rather than about the installed fixture, and it went red in CI on
   * one platform while every card anchor on the same page read correctly.
   * A canary should fail when the fixture is missing, not when something
   * unrelated is present.
   */
  readonly emptyStateHeadings: number;
}

interface Page {
  /** Stable label, used as the describe title. */
  readonly label: string;
  /** What this page is FOR, in one line. */
  readonly role: string;
  /** The page body installed into the document. */
  readonly body: string;
  /** The structure the canary grades the installed DOM against. */
  readonly spec: PageSpec;
  /** Adapters expected to claim it, and the per-adapter probe counts. */
  readonly detection: {
    readonly matched: readonly string[];
    readonly probes: Readonly<Record<string, number>>;
  };
  /** What the readiness predicate returns on it. */
  readonly ready: boolean;
}

const PAGES: readonly Page[] = [
  {
    label: "legacy-page",
    role: "one legacy card, whole counts row — the ordinary legacy page",
    body: legacyCard({ counts: WHOLE_COUNTS_ROW }),
    spec: {
      listitems: 1,
      chameleonContainers: 1,
      textBoxes: 0,
      menuButtons: 1,
      emptyStateHeadings: 0,
    },
    detection: { matched: ["legacy"], probes: { sdui: 0, legacy: 1 } },
    ready: true,
  },
  {
    label: "sdui-page",
    role: "one sdui card — the dialect this surface was last measured serving",
    body: sduiCard({ counts: WHOLE_COUNTS_ROW }),
    spec: {
      listitems: 1,
      chameleonContainers: 0,
      textBoxes: 1,
      menuButtons: 1,
      emptyStateHeadings: 0,
    },
    detection: { matched: ["sdui"], probes: { sdui: 1, legacy: 0 } },
    ready: true,
  },
  {
    label: "hybrid-page",
    role: "both dialects on one page — selection must report ambiguity, not pick",
    body: legacyCard({ counts: WHOLE_COUNTS_ROW }) + sduiCard(),
    spec: {
      listitems: 2,
      chameleonContainers: 1,
      textBoxes: 1,
      menuButtons: 2,
      emptyStateHeadings: 0,
    },
    detection: { matched: ["sdui", "legacy"], probes: { sdui: 1, legacy: 1 } },
    ready: false,
  },
  {
    label: "zero-result-page",
    role: "a search that matched nothing — no cards, so no adapter can claim it",
    body: `<main><h1>No results found</h1><p>Try different keywords.</p></main>`,
    spec: {
      listitems: 0,
      chameleonContainers: 0,
      textBoxes: 0,
      menuButtons: 0,
      // The discriminating claim: the empty-state heading is present.  Every
      // other field on this page is legitimately zero, so this is the only
      // one that can fail if the page did not install.
      emptyStateHeadings: 1,
    },
    detection: { matched: [], probes: { sdui: 0, legacy: 0 } },
    ready: false,
  },
  {
    label: "legacy-page-with-stray-sdui-chrome",
    role: "an sdui text box OUTSIDE any card — the scoping that prevents a false ambiguity",
    body:
      `<div data-testid="expandable-text-box">page chrome, not a result card</div>` +
      legacyCard({ counts: WHOLE_COUNTS_ROW }),
    spec: {
      listitems: 1,
      chameleonContainers: 1,
      textBoxes: 1,
      menuButtons: 1,
      emptyStateHeadings: 0,
    },
    detection: { matched: ["legacy"], probes: { sdui: 0, legacy: 1 } },
    ready: true,
  },
];

/**
 * Look up a declared page by label, refusing to return a page that is not
 * there.
 *
 * The obvious `PAGES.find(...)?.body ?? ""` installs an EMPTY DOCUMENT when
 * the label does not resolve, and several tests here cannot tell that apart
 * from the thing they assert: the zero-result case expects no adapter to
 * match, no readiness and a null extraction, and a blank page satisfies every
 * one of those.  A typo or a renamed {@link PAGES} entry would leave it green
 * while grading nothing — the same degenerate-gate failure the canaries exist
 * to prevent, entering through the fixture lookup instead of the install.
 *
 * Throwing names the real fault at the point it happens.
 */
function pageBody(label: string): string {
  const page = PAGES.find((p) => p.label === label);
  if (!page) {
    throw new Error(
      `No PAGES entry labelled ${JSON.stringify(label)} — declared labels: ${PAGES.map((p) => p.label).join(", ")}`,
    );
  }
  return page.body;
}

/** The extraction record the shared card loop returns for a claimed page. */
interface ExtractionRecord {
  readonly variant?: string;
  readonly postCardCount?: number;
  readonly ambiguousVariants?: readonly string[];
  readonly posts?: readonly {
    readonly authorName: string | null;
    readonly authorProfileUrl: string | null;
    readonly mediaType: string | null;
    readonly reactionCount: number;
    readonly commentCount: number;
    readonly shareCount: number;
  }[];
}

describe("search-results Tier-2 oracle (integration)", () => {
  let chromium: ChromiumInstance;
  let client: CDPClient;

  beforeAll(async () => {
    chromium = await launchChromium();
  }, 30_000);

  afterAll(async () => {
    await chromium.close();
  });

  beforeEach(async () => {
    client = new CDPClient(chromium.port, { timeout: BEFORE_EACH_TIMEOUT });
    await client.connect();
  }, BEFORE_EACH_TIMEOUT);

  afterEach(() => {
    client.disconnect();
  });

  const adapters = adaptersFor("search-results");
  const detectionSource = buildDetectionSource(adapters);
  const readinessSource = buildReadinessPredicateSource(adapters);
  const extractionSource = buildSearchResultsExtractionSource(adapters);

  /**
   * Install a page body into the live document.
   *
   * `Page.setDocumentContent` rather than a `document.body` write: draining
   * or dereferencing `document.body` on a freshly-launched target — before
   * anything has established a body — was a windows-only null crash (#866),
   * and no such unguarded dereference survives in this tree.
   *
   * Stated that narrowly on purpose.  `document.body.appendChild` is *not*
   * absent from these tests — the two sibling integration files use it freely
   * — but they replace the document through CDP in `beforeEach` first, so a
   * body always exists by the time they touch it.  This file never touches
   * `document.body` at all.  A reader auditing the constraint by grepping
   * `document.body` will find those hits; they are the guarded form, not a
   * violation.
   *
   * `CDPClient.navigate` refuses `file:` URLs and `innerHTML` is blocked by
   * Trusted Types, so this is also the only route that takes a whole page as
   * a string.
   *
   * The doctype is deliberate: `<!doctype html>` installs in standards mode
   * (`CSS1Compat`), and omitting it yields quirks mode (`BackCompat`), where
   * layout — and therefore the `offsetHeight` floor the shared card loop
   * applies — is answered under different rules.
   *
   * Honestly scoped: today's fixtures would not actually diverge between the
   * two modes, since every height-bearing element carries an explicit
   * `style="height:Npx"` with no padding or border, which resolves the same
   * either way.  The doctype and the `compatMode` assertion are a standing
   * guard for the fixtures this file will grow — the moment one relies on
   * content flow, box-model differences start deciding which side of the
   * floor a card lands on — not a claim that the present ones need it.
   */
  async function install(body: string): Promise<void> {
    const { frameTree } = (await client.send("Page.getFrameTree", {})) as {
      frameTree: { frame: { id: string } };
    };
    await client.send("Page.setDocumentContent", {
      frameId: frameTree.frame.id,
      html: shell(body),
    });
  }

  /** Count elements matching a selector on the installed page. */
  async function count(selector: string): Promise<number> {
    return client.evaluate<number>(
      `document.querySelectorAll(${jsString(selector)}).length`,
    );
  }

  /**
   * The installed page's structure, read through LITERAL selectors written
   * out here rather than imported from the adapters — see the file header.
   */
  async function readSpec(): Promise<PageSpec> {
    return {
      listitems: await count('div[role="listitem"]'),
      chameleonContainers: await count("[data-chameleon-result-urn]"),
      textBoxes: await count('[data-testid="expandable-text-box"]'),
      menuButtons: await count(
        'button[aria-label^="Open control menu for post"]',
      ),
      emptyStateHeadings: await count("main h1"),
    };
  }

  for (const page of PAGES) {
    describe(`${page.label} — ${page.role}`, () => {
      // ───────────────────────────────────────────────────────────────────
      // CANARY — the discriminator every assertion in this describe leans
      // on.  It grades the installed DOM against the structure this file
      // declares it builds, through literal selectors, so a page that
      // silently did not install is named as such rather than surfacing as
      // "the adapter did not claim it" — two diagnoses that point in
      // opposite directions.
      // ───────────────────────────────────────────────────────────────────
      it("canary: the page installed, in standards mode, with its declared structure", async () => {
        await install(page.body);

        // Quirks mode answers layout under different rules, and the shared
        // card loop's `offsetHeight` floor is a layout read.
        expect(await client.evaluate<string>("document.compatMode")).toBe(
          "CSS1Compat",
        );
        expect(await readSpec()).toEqual(page.spec);
      });

      it("the detection probe reports one count per registered adapter", async () => {
        await install(page.body);

        const detection = await client.evaluate<{
          matched: string[];
          probes: Record<string, number>;
        }>(detectionSource);

        expect(Object.keys(detection.probes).sort()).toEqual(
          [...variantNamesFor("search-results")].sort(),
        );
        expect(detection.probes).toEqual(page.detection.probes);
        expect([...detection.matched].sort()).toEqual(
          [...page.detection.matched].sort(),
        );
      });

      it("readiness is the conjunction of exclusive selection and the selected adapter's own anchor", async () => {
        await install(page.body);

        expect(await client.evaluate<boolean>(readinessSource)).toBe(
          page.ready,
        );
      });
    });
  }

  describe("selection outcomes the extraction script reports", () => {
    it("a hybrid page yields ambiguousVariants rather than a picked dialect", async () => {
      await install(
        pageBody("hybrid-page"),
      );

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.ambiguousVariants).toBeDefined();
      expect([...(record?.ambiguousVariants ?? [])].sort()).toEqual(
        ["legacy", "sdui"].sort(),
      );
      expect(record?.posts).toBeUndefined();
    });

    it("an sdui anchor outside every card does not make a legacy page ambiguous", async () => {
      await install(
        pageBody("legacy-page-with-stray-sdui-chrome"),
      );

      // The sdui `detect` anchor is scoped to a result card, which is what
      // makes it say "a search-results page speaking sdui" rather than
      // "some sdui is on this page".  The text box IS present — the canary
      // for that page counts it — and the page is still legacy alone.
      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.ambiguousVariants).toBeUndefined();
      expect(record?.variant).toBe("legacy");
      expect(record?.posts).toHaveLength(1);
    });

    it("the legacy adapter enumerates from its own container, not from the listitem", async () => {
      // A card carrying the chameleon container WITHOUT the listitem role.
      // Enumeration walks `adapter.scopes` in order, taking the first
      // candidate that matches anything, so this page is readable only if
      // enumeration consults that list at all rather than assuming the
      // structural listitem every other fixture here happens to carry.
      //
      // Deliberately NOT claimed: that this pins the tightest-first ORDER.
      // The loop falls through on a zero-match candidate, so reversing
      // `scopes` would still find the container on the second pass and yield
      // the same post.  Order is unasserted here, and cannot be asserted with
      // today's selectors, since on every other fixture both candidates
      // resolve the same element.
      await install(
        `<article data-chameleon-result-urn="urn:li:activity:5" style="height:300px">
           <a href="https://www.linkedin.com/in/test-person-5/"></a>
           <button aria-label="Open control menu for post by Test Person"></button>
           <span dir="ltr">A post body comfortably longer than twenty characters.</span>
         </article>`,
      );

      expect(await count('div[role="listitem"]')).toBe(0);
      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );
      expect(record?.variant).toBe("legacy");
      expect(record?.posts).toHaveLength(1);
    });
  });

  describe("the shared card loop — the half both dialects run", () => {
    it("reads the author name off the control menu's label, not off the card's first link", async () => {
      // The first author anchor on a card is avatar-only — empty text, no
      // name — which is why `24052dd` moved the name onto this label.  The
      // card built here reproduces that shape: the anchor holds a <figure>
      // and nothing else.
      await install(legacyCard({ name: "Test Person", counts: WHOLE_COUNTS_ROW }));

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.posts?.[0]?.authorName).toBe("Test Person");
      expect(record?.posts?.[0]?.authorProfileUrl).toBe(
        "https://www.linkedin.com/in/test-person-1/",
      );
    });

    it("accepts a company page as the author link and strips its query string", async () => {
      await install(
        `<div role="listitem" data-chameleon-result-urn="urn:li:activity:6" style="height:300px">
           <a href="https://www.linkedin.com/company/linkedin/?trk=search"></a>
           <button aria-label="Open control menu for post by LinkedIn"></button>
           <span dir="ltr">A post body comfortably longer than twenty characters.</span>
         </div>`,
      );

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.posts?.[0]?.authorName).toBe("LinkedIn");
      expect(record?.posts?.[0]?.authorProfileUrl).toBe(
        "https://www.linkedin.com/company/linkedin/",
      );
    });

    it("skips a card below the height floor, and counts no cardinal for it", async () => {
      // `offsetHeight` is a layout read, so this is one of the answers only
      // a real browser can give: the Tier-1 stand-in has no layout at all.
      await install(legacyCard({ counts: WHOLE_COUNTS_ROW, height: 40 }));

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      // The card is skipped BEFORE the cardinal increments, so the page
      // reports a corroborated empty rather than a contradiction.  Both
      // halves matter: an empty `posts` alone would be indistinguishable
      // from the contradiction case below.
      expect(record?.postCardCount).toBe(0);
      expect(record?.posts).toHaveLength(0);
    });

    it("reports a video card's media type", async () => {
      // The image branch is deliberately not exercised: it keys on
      // `img[src*="media.licdn.com"]`, and a matching `src` would be a live
      // fetch — this suite runs with no network, the same property the
      // harvested fixtures are scrubbed to preserve.  `<video>` needs no
      // source attribute to be found.
      await install(
        legacyCard({ counts: WHOLE_COUNTS_ROW, extra: "<video></video>" }),
      );

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.posts?.[0]?.mediaType).toBe("video");
    });

    it("reports no media type for a card carrying neither video nor image", async () => {
      // The negative control the video assertion above needs.  Without it, an
      // extractor that set `mediaType = "video"` unconditionally would satisfy
      // every media assertion in this file — presence asserted, absence never.
      await install(legacyCard({ counts: WHOLE_COUNTS_ROW }));

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.posts).toHaveLength(1);
      expect(record?.posts?.[0]?.mediaType).toBeNull();
    });

    it("runs the same loop on an sdui card, off that dialect's own scope", async () => {
      // Everything above grades the shared loop through a LEGACY card, which
      // leaves this describe's own title — "the half both dialects run" —
      // asserted for one dialect only.  The gap is not cosmetic: the two
      // adapters enumerate off different `scopes` (legacy tries its
      // chameleon container first, sdui has only the structural listitem),
      // so a break in sdui's enumeration would leave `detect` still matching
      // and every selection test above still green while extraction returned
      // null.  Detection says an adapter CLAIMS the page; only this says it
      // can read one.
      //
      // The fields asserted are exactly the dialect-INDEPENDENT ones — the
      // shared builder's, not `adapter.extract`'s.  The three fields that
      // extractor owns stay ungraded for the reason the file header gives.
      await install(sduiCard({ counts: WHOLE_COUNTS_ROW }));

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.variant).toBe("sdui");
      expect(record?.postCardCount).toBe(1);
      expect(record?.posts).toHaveLength(1);
      expect(record?.posts?.[0]?.authorName).toBe("Test Person");
      expect(record?.posts?.[0]?.authorProfileUrl).toBe(
        "https://www.linkedin.com/in/test-person-2/",
      );
      expect(record?.posts?.[0]?.reactionCount).toBe(2);
      expect(record?.posts?.[0]?.commentCount).toBe(41);
    });

    it("skips an sdui card below the height floor too", async () => {
      // The floor is applied in the shared loop, before either dialect's
      // extractor runs, so it has to hold for sdui on the same terms the
      // legacy case above pins.  Asserting it for one dialect would leave
      // the claim "shared" only by inspection.
      await install(sduiCard({ counts: WHOLE_COUNTS_ROW, height: 40 }));

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.postCardCount).toBe(0);
      expect(record?.posts).toHaveLength(0);
    });
  });

  describe("per-card engagement counts", () => {
    it("a whole counts row parses to the numbers the page renders", async () => {
      // The control for the tripwires below, and it must stay green: a fix
      // for #869 that returned 0 everywhere would satisfy them and destroy
      // this.  Same joint-satisfaction discipline as the post-detail
      // fixture pair.
      await install(legacyCard({ counts: WHOLE_COUNTS_ROW }));

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.posts?.[0]?.reactionCount).toBe(2);
      expect(record?.posts?.[0]?.commentCount).toBe(41);
      expect(record?.posts?.[0]?.shareCount).toBe(0);
    });

    it("a whole reposts phrase parses to a non-zero share count", async () => {
      // The only green assertion in this file that witnesses a NON-ZERO
      // `shareCount`, and it is here for that reason alone.  Every other
      // passing share assertion expects 0 against a row rendering no reposts
      // at all, which a counter that always returned 0 would also satisfy —
      // so without this, a #869 fix that got reactions and comments right and
      // silently zeroed reposts would ship with the whole suite green.
      await install(legacyCard({ counts: WHOLE_REPOSTS_ROW }));

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.posts).toHaveLength(1);
      expect(record?.posts?.[0]?.reactionCount).toBe(2);
      expect(record?.posts?.[0]?.commentCount).toBe(41);
      expect(record?.posts?.[0]?.shareCount).toBe(3);
    });

    it("a one-node counts row parses correctly today, and must keep doing so", async () => {
      // A CONTROL, not a tripwire: today's whole-card text read already gets
      // this right, so it is green before #869 and must stay green after.
      //
      // It is the only fixture here whose counters do NOT each render on
      // their own element, which makes it the only one that can catch a fix
      // porting post detail's anchored per-element read WITHOUT giving this
      // surface a counts anchor to narrow to.  Such a fix finds no element
      // matching `^<N> comments$`, never reaches the loose fallback that
      // rescues this shape, and returns 0 — turning a currently-correct read
      // into a regression that every other fixture here would miss.
      await install(legacyCard({ counts: ONE_NODE_COUNTS_ROW }));

      const cardText = await client.evaluate<string>(
        `(document.querySelector(${jsString("[data-chameleon-result-urn]")})?.textContent ?? "")`,
      );

      // The separator survives: this row is NOT the concatenation case.
      expect(cardText).toContain("2 41 comments");

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.posts).toHaveLength(1);
      expect(record?.posts?.[0]?.commentCount).toBe(41);
      expect(record?.posts?.[0]?.reactionCount).toBe(0);
    });

    it("counts stay inside their own card", async () => {
      // The bound #869 names: the read is scoped to one card, so it cannot
      // pull a count in from a different post.  Pinned because it is what a
      // document-wide "fix" would break — the failure `get-post-stats`
      // already carries as #857.
      await install(
        legacyCard({ counts: WHOLE_COUNTS_ROW }) +
          legacyCard({ urn: "urn:li:activity:2", name: "Other Person" }),
      );

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.posts).toHaveLength(2);
      expect(record?.posts?.[1]?.authorName).toBe("Other Person");
      expect(record?.posts?.[1]?.reactionCount).toBe(0);
      expect(record?.posts?.[1]?.commentCount).toBe(0);
      expect(record?.posts?.[1]?.shareCount).toBe(0);
    });

    // ─────────────────────────────────────────────────────────────────────
    // #869 — FIXED.  The three blocks below were authored as `it.fails`
    // stating the CORRECT contract rather than the behaviour of the day, so
    // that fixing the parse turned them red and the flip had to be
    // acknowledged in a visible `it.fails(` -> `it(` diff instead of being
    // silently absorbed.  They are plain `it` now, and that is the whole of
    // what the flip means: it records that the contract below is MET, not
    // that the blocks became less load-bearing.  They are regression tests
    // from here on — asserting `241` in any of them would bake the defect
    // back into the oracle and make the next fix look like the regression.
    //
    // TWO defects, deliberately separated — they are independent, and a fix
    // for one does not imply a fix for the other.  Both are stated in the
    // past tense because both are closed; the separation is kept because it
    // is what the fixture split still encodes, and re-fusing them is how the
    // first attempt produced a fixture that could witness neither:
    //
    // 1. THE JOIN.  `__lhParseCount` read each counter out of
    //    `card.textContent` with no normalisation.  Under `textContent`
    //    adjacent element text nodes concatenate with NO separator, so a row
    //    rendering `2` and `41 comments` as two elements flattened to
    //    `241 comments` and the comment regex captured 241.
    // 2. THE LABEL.  LinkedIn renders a reaction count as a bare number with
    //    the words only on the control's `aria-label`.  A text-only read
    //    never looked there, so it found no reaction count at all — which is
    //    why `__lhReadCount` consults `aria-label` before text, and is a
    //    separate miss from the concatenation.  Inserting a separator would
    //    not have fixed it.
    //
    // Hence the fixture split.  The labelled row exercises both and its
    // block asserts both; the unlabelled row exercises the join alone, so its
    // block asserts the comment count ONLY — with no "reactions" token
    // anywhere, 0 is correct both before and after, and demanding otherwise
    // would have made that block unflippable.  Both surfaces now run the same
    // anchored per-element read: `dom-variant.ts` hands the card to
    // `__lhReadCount` as an already-narrowed counts root.
    // ─────────────────────────────────────────────────────────────────────

    it("canary: the browser joins the row, and the word lives only on the label", async () => {
      await install(legacyCard({ counts: LABELLED_SPLIT_COUNTS_ROW }));

      // Read through a literal selector, independent of every adapter: this
      // is the BROWSER's join, not an assertion about our code.  It is what
      // makes the tripwires below a statement about the parse rather than
      // about the page.
      const cardText = await client.evaluate<string>(
        `(document.querySelector(${jsString("[data-chameleon-result-urn]")})?.textContent ?? "")`,
      );

      expect(cardText).toContain("241 comments");

      // Load-bearing, and the reason the tripwire below is flippable at all:
      // the words "2 reactions" are NOT in the card's text.  That is why the
      // current text-only read reports no reactions, and why an anchored read
      // that consults `aria-label` recovers them.
      expect(cardText).not.toContain("2 reactions");
      expect(
        await client.evaluate<string | null>(
          `document.querySelector(${jsString('[data-chameleon-result-urn] button:not([aria-label^="Open control menu"])')})?.getAttribute("aria-label") ?? null`,
        ),
      ).toBe("2 reactions");
    });

    it("canary: the split counts page is claimed and yields exactly one post", async () => {
      // The second half of the canary, and it is not redundant.  A tripwire
      // reading `record?.posts?.[0]?.commentCount` against an EMPTY array
      // short-circuits through the optional chain to `undefined` rather than
      // throwing, so `expect(undefined).toBe(41)` fails and the `it.fails`
      // block goes green for a reason that has nothing to do with the count
      // it names.  This pins that a post came back at all.
      await install(legacyCard({ counts: LABELLED_SPLIT_COUNTS_ROW }));

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.variant).toBe("legacy");
      expect(record?.postCardCount).toBe(1);
      expect(record?.posts).toHaveLength(1);
    });

    it("canary + control: an unlabelled bare number is honestly zero, before and after #869", async () => {
      // Two jobs, and it carries both deliberately.
      //
      // As the CANARY for the unlabelled tripwire below, it is the only test
      // installing that page — a different page from the labelled one the two
      // canaries above install, so neither of those covers it.  It therefore
      // carries the same two claims they do: the browser's join, and that a
      // post came back at all.
      //
      // As a CONTROL, it pins what must NOT change.  With no "reactions"
      // token in the text and none on a control, 0 is the correct reaction
      // count — the position `dom-variant.integration.test.ts` already pins
      // for post detail ("0 reactions is the honest answer, not a miss").  So
      // it stays green across #869, and it is what stops the fix being a
      // positional guess: a read deciding the leading bare number in a counts
      // row is the reaction count would satisfy the tripwires and break this,
      // reintroducing the always-true anchor ADR-008 § Decision 3 removed.
      await install(legacyCard({ counts: UNLABELLED_SPLIT_COUNTS_ROW }));

      const cardText = await client.evaluate<string>(
        `(document.querySelector(${jsString("[data-chameleon-result-urn]")})?.textContent ?? "")`,
      );

      // The join, witnessed for THIS row rather than inherited from the
      // labelled one: the two counters are different markup (a button there,
      // a bare span here), so the concatenation is a separate observation.
      // Only the positive claim: a `not.toContain("2 reactions")` here could
      // never fail, since this row renders no "reactions" token in text or in
      // any attribute.  The same-looking assertion on the LABELLED row is not
      // vacuous — there the string exists, on the button's `aria-label`, so it
      // pins that attribute text stays out of `textContent`.
      expect(cardText).toContain("241 comments");

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.variant).toBe("legacy");
      expect(record?.postCardCount).toBe(1);
      expect(record?.posts).toHaveLength(1);
      expect(record?.posts?.[0]?.reactionCount).toBe(0);
    });

    it(
      "an unlabelled split row still yields the comment count the page renders",
      async () => {
        // The join half on its own, with the label removed.  The comment
        // count is wrong today for the concatenation reason alone — 241 — and
        // is 41 under any fix that stops flattening the card into one string.
        // The reaction count is excluded from this block on purpose: it is 0
        // both before and after, so asserting it here would make the block
        // unflippable.
        await install(legacyCard({ counts: UNLABELLED_SPLIT_COUNTS_ROW }));

        const record = await client.evaluate<ExtractionRecord | null>(
          extractionSource,
        );

        // Before #869 this measured commentCount 241 — the join.
        expect(record?.posts?.[0]?.commentCount).toBe(41);
      },
    );

    it(
      "a labelled split counts row yields the reaction and comment counts the page renders",
      async () => {
        await install(legacyCard({ counts: LABELLED_SPLIT_COUNTS_ROW }));

        const record = await client.evaluate<ExtractionRecord | null>(
          extractionSource,
        );

        // Before #869 this measured reactionCount 0 (the word is on the
        // label, and the text-only read never looked there) and commentCount
        // 241 (the join).  Both are recovered by the anchored per-element read
        // that consults `aria-label` first — `__lhReadCount`, which this
        // surface now runs alongside post detail.
        expect(record?.posts?.[0]?.reactionCount).toBe(2);
        expect(record?.posts?.[0]?.commentCount).toBe(41);
      },
    );

    it("canary: the reposts page joins its own row and yields exactly one post", async () => {
      // The reposts tripwire installs a DIFFERENT page from every counts
      // canary above, so none of them covers it.  Without this one, a
      // `SPLIT_REPOSTS_ROW` page that stopped installing — or stopped
      // yielding a card — would make `posts[0].shareCount` `undefined`,
      // fail the tripwire's `toBe(3)`, and turn `it.fails` green while
      // measuring nothing about the parse.  Both claims are carried here for
      // the same reason the split-counts pair carries them separately: the
      // browser's join, and the fact that a post came back at all.
      await install(legacyCard({ counts: SPLIT_REPOSTS_ROW }));

      const cardText = await client.evaluate<string>(
        `(document.querySelector(${jsString("[data-chameleon-result-urn]")})?.textContent ?? "")`,
      );

      // Only the positive claim is asserted.  A `not.toContain("3 reposts")`
      // would be false — "3 reposts" is a substring of the joined
      // "73 reposts" — and a `not.toContain("7 reactions")` could never fail,
      // since this row renders no "reactions" token in any arrangement.
      expect(cardText).toContain("73 reposts");

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.variant).toBe("legacy");
      expect(record?.postCardCount).toBe(1);
      expect(record?.posts).toHaveLength(1);
    });

    it(
      "a split reposts row yields the repost count the page renders",
      async () => {
        await install(legacyCard({ counts: SPLIT_REPOSTS_ROW }));

        // Before #869 this measured shareCount 73 — `7` and `3 reposts`
        // joined.
        const record = await client.evaluate<ExtractionRecord | null>(
          extractionSource,
        );

        expect(record?.posts?.[0]?.shareCount).toBe(3);
      },
    );
  });

  describe("the empty-vs-error contract on this surface", () => {
    // `postCardCount` counts cards that are post-shaped EXCLUDING the
    // menu-button filter, so the cardinal and `posts.length` diverge on
    // exactly that one condition — the dominant suspected failure path.
    // These two cases are a pair and are satisfied jointly or not at all:
    // optimising for the contradiction alone yields always-throw-on-empty
    // and destroys a legal outcome, optimising for the control alone
    // restores the silent-empty defect.

    it("a card with no control menu contradicts the page's own cardinal", async () => {
      await install(legacyCard({ menuButton: false, counts: WHOLE_COUNTS_ROW }));

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      // One post-shaped card, no post extracted — the two halves of one
      // observation disagree, so this is not evidence the search found
      // nothing.
      expect(record?.postCardCount).toBe(1);
      expect(record?.posts).toHaveLength(0);
      expect(() => {
        assertCardinalCorroboration({
          surface: "search-results",
          variant: record?.variant ?? "legacy",
          field: "posts",
          cardinalName: "postCardCount",
          cardinal: record?.postCardCount ?? 0,
          extractedCount: record?.posts?.length ?? 0,
        });
      }).toThrow();
    });

    it("a page whose cards all extract cleanly raises nothing", async () => {
      await install(legacyCard({ counts: WHOLE_COUNTS_ROW }));

      const record = await client.evaluate<ExtractionRecord | null>(
        extractionSource,
      );

      expect(record?.postCardCount).toBe(1);
      expect(record?.posts).toHaveLength(1);
      expect(() => {
        assertCardinalCorroboration({
          surface: "search-results",
          variant: record?.variant ?? "legacy",
          field: "posts",
          cardinalName: "postCardCount",
          cardinal: record?.postCardCount ?? 0,
          extractedCount: record?.posts?.length ?? 0,
        });
      }).not.toThrow();
    });
  });

  describe("the zero-result page — the ambiguity ADR-008 records", () => {
    it("reports no adapter, which on this surface has two readings", async () => {
      // A search that matched nothing renders no result cards, so no
      // adapter's `detect` anchor can match either, and a WORKING page is
      // reported unsupported.  The two states — LinkedIn changed its markup,
      // and the search legitimately matched nothing — are indistinguishable
      // from the DOM with what is measured today.
      //
      // This is pinned as the CURRENT behaviour, not endorsed as correct,
      // and it is deliberately not "fixed" here: no live probe of a
      // zero-result search page exists, so any "empty results" container
      // this file anchored on would be a GUESS sitting where ADR-008
      // § Decision 3 requires a decisive anchor — the same move as the
      // always-true `<main>` fallback that decision removed.  Closing it
      // needs the probe, which is #868's open residual; making the failure
      // legible in the field is #870.
      await install(
        pageBody("zero-result-page"),
      );

      const detection = await client.evaluate<{
        matched: string[];
        probes: Record<string, number>;
      }>(detectionSource);

      expect(detection.matched).toEqual([]);
      expect(detection.probes).toEqual({ sdui: 0, legacy: 0 });
      expect(await client.evaluate<boolean>(readinessSource)).toBe(false);
      // `null` — no adapter claimed the page — rather than an empty result
      // set, which is what makes the caller raise instead of reporting a
      // search that found nothing.
      expect(
        await client.evaluate<ExtractionRecord | null>(extractionSource),
      ).toBeNull();
    });
  });
});
