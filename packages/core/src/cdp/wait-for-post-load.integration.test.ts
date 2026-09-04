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
import { adaptersFor } from "../linkedin/dom-variant.js";
import { jsString } from "../utils/js-string.js";
import { CDPClient } from "./client.js";
import {
  INSTALL_TEST_TIMEOUT_MS,
  installDocument,
} from "./testing/install-document.js";
import { launchChromium, type ChromiumInstance } from "./testing/launch-chromium.js";
import { POST_DETAIL_CAPTURE_PROBE_SCRIPT } from "./wait-for-post-load.js";

/** Timeout for beforeEach operations (connect) on slow CI runners. */
const BEFORE_EACH_TIMEOUT = 15_000;

/**
 * Tier-2 oracle for the post-detail diagnostic capture probe (#853).
 *
 * ## Why this file exists at all
 *
 * {@link POST_DETAIL_CAPTURE_PROBE_SCRIPT} is a hand-written wrapper with a
 * registry-generated program spliced into it.  Nothing else executes it: the
 * Tier-1 suite mocks `client.evaluate` away and grades the string by
 * substring, and the generator's own unit tests grade the generated fragment
 * in isolation.  So this is the only tier where a defect in the COMPOSITION —
 * a hand-quoted selector, a stray backtick in one of its comments, a probe key
 * colliding with a fixed field — is ever observed.
 *
 * The consequence of not observing it is silent, which is why it earns a tier:
 * `client.evaluate` rejects, `capturePostLoadFailure`'s own `.catch` swallows
 * the rejection, and the operator gets no json, no png and no warn line at the
 * one moment they are reading diagnostics.
 *
 * ## Why it lives in `cdp/` rather than beside its sibling
 *
 * The search-results equivalent sits in `linkedin/__tests__/`.  This one is
 * routed here deliberately: the module under test is `cdp/wait-for-post-load.ts`,
 * `cdp/client.integration.test.ts` is the existing precedent for a Tier-2 suite
 * in this directory, and `linkedin/__tests__/` is concurrently owned elsewhere.
 *
 * ## What it does NOT grade
 *
 * Not whether the adapters' selectors are the RIGHT ones for a live LinkedIn
 * page — that is Tier 3, and the fixture oracle in `linkedin/__tests__/`.  The
 * pages installed below are authored here, so grading extraction against them
 * would grade this file's own markup.  What is graded is the property those
 * cannot settle: that the composed program parses, runs, reports a reading per
 * registered dialect, and that the readings TRACK THE PAGE rather than being
 * constants.
 */

/** The document shell.  The doctype installs standards mode, not quirks. */
function shell(body: string): string {
  return `<!doctype html><html><head></head><body>${body}</body></html>`;
}

/**
 * A page carrying the LEGACY post-detail root and its counts row, and no SDUI
 * marker of any kind.
 *
 * Written with literal selectors rather than by importing the adapter's own
 * anchors: markup authored FROM the anchor under test would be graded against
 * itself, and could not witness a variant flip — the one thing this suite is
 * for.  If an anchor below drifts from the registry, the assertions go red,
 * which is the intended signal rather than a maintenance cost to avoid.
 */
const LEGACY_PAGE = shell(`
  <main>
    <div data-urn="urn:li:activity:7436698865522851840">
      <a href="https://www.linkedin.com/in/someone/">Someone</a>
      <a href="https://www.linkedin.com/company/acme/">Acme</a>
      <div class="social-details-social-counts">2 41 comments</div>
    </div>
  </main>
`);

/**
 * Author links inside {@link LEGACY_PAGE}'s update container.
 *
 * TWO, deliberately, and it is the only reason the second one is there.  The
 * readings are `querySelectorAll(...).length`, and a "simplification" to
 * `querySelector(...) ? 1 : 0` is behaviourally identical on every page that
 * renders each anchor once — so a one-match fixture cannot tell a count from a
 * boolean, and the whole justification for replacing `hasPostDetailContainer`
 * with counts would go ungraded.  That justification is not abstract: on
 * 2026-08-31 a `<main>`-scoped author link matched 85 elements on a
 * post-detail page every scraper selector read as empty, and one-versus-85 is
 * the question that was actually being asked.  A boolean cannot ask it.
 */
const LEGACY_PAGE_AUTHOR_LINKS = 2;

/** A page with a `<main>` and nothing either dialect anchors on. */
const BARE_PAGE = shell("<main><h1>Something else entirely</h1></main>");

describe("post-detail capture probe Tier-2 oracle (integration)", { timeout: INSTALL_TEST_TIMEOUT_MS }, () => {
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

  /**
   * Install a whole page into the live document.
   *
   * Routed through the shared {@link installDocument} gate rather than calling
   * `Page.setDocumentContent` and reading straight after it.  That pairing is
   * the #888 flake verbatim: `querySelectorAll(…).length` answers `0` rather
   * than throwing when the document it runs against is not the one just
   * installed, so a raced install produces a clean, wrong zero for EVERY
   * selector — which on this file would read as "the probe measured nothing"
   * and is exactly the reading its anti-circularity case is here to make
   * impossible.  The helper does not return until the installed document is
   * observable through the same un-parameterised `evaluate` these assertions
   * use.
   *
   * `Page.setDocumentContent` (which the helper performs) rather than a
   * `document.body` write: dereferencing `document.body` on a freshly-launched
   * target — before anything has established one — was a windows-only null
   * crash (#866).  `CDPClient.navigate` refuses `file:` URLs and `innerHTML` is
   * blocked by Trusted Types, so this is also the only route taking a whole
   * page as a string.
   */
  async function install(html: string): Promise<void> {
    await installDocument(client, html);
  }

  /** Count elements matching a selector on the installed page. */
  async function count(selector: string): Promise<number> {
    return client.evaluate<number>(
      `document.querySelectorAll(${jsString(selector)}).length`,
    );
  }

  interface AnchorReading {
    ready: number;
    scopes: Record<string, number>;
    counts: Record<string, number>;
  }

  async function probe(): Promise<Record<string, unknown>> {
    return client.evaluate<Record<string, unknown>>(
      POST_DETAIL_CAPTURE_PROBE_SCRIPT,
    );
  }

  /** The probe's `variantAnchors`, as a map that may legitimately lack a key. */
  function anchorsOf(
    result: Record<string, unknown>,
  ): Record<string, AnchorReading | undefined> {
    return result.variantAnchors as Record<string, AnchorReading | undefined>;
  }

  /**
   * One dialect's reading, or a named failure.
   *
   * A helper rather than a bare index, and it is a strengthening rather than a
   * `noUncheckedIndexedAccess` workaround: a missing dialect is precisely the
   * regression these cases exist to catch, and an unchecked index reports it
   * as `Cannot read properties of undefined` at whichever property happens to
   * be touched first — which names neither the dialect nor the claim. This
   * fails on the absence itself, and says which dialect went missing.
   */
  function readingFor(
    result: Record<string, unknown>,
    variant: string,
  ): AnchorReading {
    const reading = anchorsOf(result)[variant];
    if (reading === undefined) {
      throw new Error(`probe reported no anchor reading for variant ${variant}`);
    }
    return reading;
  }

  it("parses and runs, returning exactly the documented key set", async () => {
    await install(LEGACY_PAGE);

    const result = await probe();

    // Exact, not a superset.  The anchor readings are nested under one key
    // rather than spread, so a collision is impossible by construction — but
    // the fixed half is a hand-written object literal, and a key added there
    // without a corresponding doc line is exactly the drift the `Probe set:`
    // line exists to prevent.
    expect(Object.keys(result).sort()).toEqual(
      [
        "bodyTextSnippet",
        "commentElementCount",
        "hasArticles",
        "hasAuthorLink",
        "hasAuthorLinkInMain",
        "hasCommentOnButton",
        "hasLtrSpans",
        "hasMain",
        "hasMainFeed",
        "hasReactLikeButton",
        "hasReactionsMenu",
        "hasTopLevelEditor",
        "href",
        "mainFeedListItemCount",
        "mainFeedListItemsViableForPostScrape",
        "mainFeedListItemsWithMenuButton",
        "title",
        "variantAnchors",
      ].sort(),
    );
  });

  it("reports one reading per registered adapter, under that adapter's own name", async () => {
    await install(LEGACY_PAGE);

    const result = await probe();
    const adapters = adaptersFor("post-detail");

    // Cardinality against the registry, so a registry that came back empty
    // cannot make the loop below vacuous.
    expect(adapters.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(anchorsOf(result)).sort()).toEqual(
      adapters.map((a) => String(a.variant)).sort(),
    );

    for (const adapter of adapters) {
      const reading = readingFor(result, String(adapter.variant));
      // `detect` is deliberately absent: it is read on the classification path
      // and reaches the bundle as `variantDetection`, so giving it a second
      // home here would report one anchor ROLE twice.  The SELECTOR may still
      // be read twice where a dialect uses one string in two roles — `legacy`'s
      // `detect` is its `scopes[0]` — which is recorded rather than removed.
      expect(Object.keys(reading).sort()).toEqual(
        ["counts", "ready", "scopes"].sort(),
      );
      expect(Object.keys(reading.scopes).sort()).toEqual(
        [...adapter.scopes].sort(),
      );
      expect(Object.keys(reading.counts).sort()).toEqual(
        [...adapter.counts].sort(),
      );
    }
  });

  it("reads the page it is pointed at, not a constant", async () => {
    // The anti-circularity control this suite owes.  A probe returning fixed
    // values satisfies both cases above while measuring nothing, so two
    // structurally different pages must produce different readings.
    await install(LEGACY_PAGE);
    const onLegacy = await probe();

    await install(BARE_PAGE);
    const onBare = await probe();

    // Legacy page: its root resolved, its ready anchor followed, its counts
    // row rendered.  This is the reading no field in the pre-#853 bundle could
    // produce — the legacy dialect's own anchors went entirely unprobed.
    const legacyOnLegacy = readingFor(onLegacy, "legacy");
    expect(legacyOnLegacy.scopes['[data-urn^="urn:li:activity:"]']).toBe(1);
    // Two, not "truthy".  See LEGACY_PAGE_AUTHOR_LINKS: this is the assertion
    // that separates a COUNT from the boolean it replaced, and it is the only
    // one in the suite that can.
    expect(legacyOnLegacy.ready).toBe(LEGACY_PAGE_AUTHOR_LINKS);
    expect(legacyOnLegacy.counts[".social-details-social-counts"]).toBe(1);
    // ...and the other dialect is silent on it, which is what makes the two
    // readings a diagnosis rather than a pair of numbers.
    expect(readingFor(onLegacy, "sdui").ready).toBe(0);

    // Bare page: everything collapses.
    const legacyOnBare = readingFor(onBare, "legacy");
    expect(legacyOnBare.scopes['[data-urn^="urn:li:activity:"]']).toBe(0);
    expect(legacyOnBare.ready).toBe(0);
    expect(legacyOnBare.counts[".social-details-social-counts"]).toBe(0);

    // Canary: the bare page really did install, so the zeros above are a
    // reading rather than a document that never arrived.
    expect(await count("main h1")).toBe(1);
  });

  it("reports the SDUI screen root the pre-#853 bundle could not distinguish", async () => {
    // `sdui.detect` is the UNION of the container and the screen wrapper, so
    // `variantDetection.probes.sdui === 1` cannot say which one matched, and
    // the old `hasPostDetailContainer` boolean covered only the container.  A
    // page serving the screen wrapper alone was therefore invisible.
    await install(
      shell(
        '<main><div data-sdui-screen="com.linkedin.sdui.flagshipnav.feed.UpdateDetail">' +
          '<a href="https://www.linkedin.com/in/someone/">Someone</a></div></main>',
      ),
    );

    const sdui = readingFor(await probe(), "sdui");

    expect(
      sdui.scopes[
        '[data-sdui-screen="com.linkedin.sdui.flagshipnav.feed.UpdateDetail"]'
      ],
    ).toBe(1);
    expect(
      sdui.scopes[
        '[componentkey^="expanded"][componentkey$="FeedType_FEED_DETAIL"]'
      ],
    ).toBe(0);
    // The screen half of `ready` follows from the screen root being present.
    expect(sdui.ready).toBe(1);
  });

  it("still probes every supplementary marker no adapter anchors on", async () => {
    // The anti-narrowing criterion at the tier that can actually execute it:
    // each marker must yield a reading attributable to it, not merely appear
    // in the source.  The page below renders one of each.
    await install(
      shell(`
        <a href="https://www.linkedin.com/in/outside-main/">Nav chip</a>
        <main>
          <span dir="ltr">Post body</span>
          <button aria-label="React Like to Someone's post">Like</button>
          <button aria-label="Comment on Someone's post">Comment</button>
          <div role="textbox" aria-label="Text editor for creating content">x</div>
          <button aria-label="Open reactions menu">Reactions</button>
          <div componentkey="replaceableComment_urn:li:comment:(activity:1,2)">c</div>
          <article>a</article>
        </main>
      `),
    );

    const result = await probe();

    // The author-link PAIR, on a page built so the two must disagree: the only
    // anchor is a nav chip OUTSIDE `<main>`.  Both probes read `true` on any
    // page that puts its author link inside `<main>`, so a fixture like that
    // cannot tell the two apart — and transposing the two constants is the
    // easy mistake, since the `<main>`-scoped one is named
    // `POST_READY_AUTHOR_LINK_SELECTOR` and the unscoped one
    // `POST_AUTHOR_LINK_DOCUMENT_WIDE_SELECTOR`.  The pair exists precisely to
    // separate "page failed to render entirely" from "page rendered nav /
    // sidebar chips but not the post body", which is this page exactly.
    expect(result.hasAuthorLink).toBe(true);
    expect(result.hasAuthorLinkInMain).toBe(false);
    expect(result.hasLtrSpans).toBe(true);
    expect(result.hasReactLikeButton).toBe(true);
    expect(result.hasCommentOnButton).toBe(true);
    expect(result.hasTopLevelEditor).toBe(true);
    expect(result.hasReactionsMenu).toBe(true);
    expect(result.hasArticles).toBe(true);
    expect(result.commentElementCount).toBe(1);
    expect(result.hasMain).toBe(true);

    // The negative half, on the same page: these markers are genuinely absent
    // here, so the trues above are readings rather than a probe stuck on.
    expect(result.hasMainFeed).toBe(false);
    expect(result.mainFeedListItemCount).toBe(0);
  });

  it("bounds the body-text snippet it carries off the page", async () => {
    // The snippet is the one field carrying page PROSE rather than a count, so
    // its 800-character cap is a data-minimisation control — these artifacts
    // hold personal data — and not a formatting choice.
    await install(shell(`<main><p>${"x".repeat(4000)}</p></main>`));

    const result = await probe();

    expect(String(result.bodyTextSnippet).length).toBe(800);
  });
});
