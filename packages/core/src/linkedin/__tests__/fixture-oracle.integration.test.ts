// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CDPClient } from "../../cdp/client.js";
import {
  launchChromium,
  type ChromiumInstance,
} from "../../cdp/testing/launch-chromium.js";
import { assertCardinalCorroboration } from "../corroboration.js";
import {
  adaptersFor,
  buildDetectionSource,
  buildPostDetailExtractionSource,
  buildReadinessPredicateSource,
  variantNamesFor,
} from "../dom-variant.js";

/** Timeout for beforeEach operations (connect) on slow CI runners. */
const BEFORE_EACH_TIMEOUT = 15_000;

/**
 * The fixture oracle — the adapters graded against real captured LinkedIn
 * markup.
 *
 * Per ADR-004 the Tier-3 E2E suite never runs in CI, so this tier is the only
 * one that can gate a DOM variant flip before merge.  The defect it exists to
 * catch was measured live on 2026-08-31: LinkedIn reverted post-detail to
 * legacy markup, every SDUI field selector matched 0, and the readiness gate
 * — anchored on variant-agnostic selectors — still went green.  `get-post`
 * returned `text: ""` and `comments: []` beside `commentCount: 41`, over an
 * HTTP success, with no error raised anywhere.
 *
 * ## Why this is a sibling of `dom-variant.integration.test.ts`
 *
 * That file states its own boundary: it grades *selection* against DOM built
 * with real DOM APIs and "deliberately does NOT assert extracted field values
 * against harvested LinkedIn markup — that needs real captured pages and is
 * the fixture oracle's job".  This is that job.  Extending that file would
 * contradict the boundary it declares; the browser setup is reused rather
 * than duplicated (`launchChromium`, `CDPClient`), and only fixture
 * installation is new.
 *
 * ## Loading a fixture
 *
 * Two routes are closed, both deliberately.  `CDPClient.navigate` refuses
 * `file:` URLs (`Unsafe URL scheme`), and `innerHTML` is blocked by
 * Chromium's Trusted Types policy — which is why the sibling file rebuilds
 * its small synthetic DOM through DOM APIs, impractical for a 352 KB page.
 * `Page.setDocumentContent` is neither, so that is what {@link installFixture}
 * uses.  Fixtures load with zero outbound requests (every asset is an inline
 * `data:` URI, enforced by the harvester's network gate), so this suite runs
 * on a CI runner with no network and no LinkedHelper.
 *
 * ## The canary, and why it is not tidiness
 *
 * The legacy assertions below were `it.fails` until #872 was fixed, and the
 * canary is what kept that construct honest: an `it.fails` block passes
 * whenever its body fails **for any reason**, so a fixture that never loaded
 * would have made every one of them green while testing nothing — the
 * degenerate gate wearing the costume of the fix for it.
 *
 * They are plain `it` now.  That inverts the failure without removing the
 * need — and the inversion is PARTIAL, which is the part worth knowing.  A
 * fixture that never loads leaves a blank document, and against a blank
 * document roughly half the assertions here still pass: every value they
 * compare is `0`, `""` or `null`, which is what a legal-empty page looks
 * like.  So a dead load shows up as a confusing half-red board rather than a
 * clean all-red one.
 *
 * The canary is what resolves it, and it is the SOLE discriminator.  It
 * grades the installed DOM against the `.measured.json` sidecar recorded on
 * the live page before scrubbing, using literal selectors only — so it stays
 * green under a selector regression and goes red under an infrastructure
 * fault.  That separates "the 352 KB fixture never installed" from "the
 * adapter no longer claims this page", which are diagnosed in opposite
 * directions.
 *
 * ## Documented coverage gap — two fixtures deliberately not captured
 *
 * #838 was scoped against four fixtures; #828 delivered two, and recorded the
 * other two as not-capturable rather than approximating them.  Reasons are in
 * `../__fixtures__/README.md` § "Not captured, and why", restated here so a
 * reader of this file does not conclude they were forgotten:
 *
 * - **`legacy/post-image-only.html`** — no candidate exists.  Every post on
 *   the capturing account carries 1,275–2,270 characters of body text.
 *   Harvesting a third party's post would put someone else's content in a
 *   public repo, and fabricating one would make this oracle tautological: it
 *   would assert against markup written to satisfy it, which cannot witness a
 *   variant flip.
 * - **`sdui/post-with-comments.html`** — not harvestable at capture time.
 *   LinkedIn currently serves legacy markup on post-detail, which is the
 *   defect under repair.  The dialect split is per-surface — the *feed* was
 *   simultaneously serving SDUI — so an SDUI capture is available from a
 *   different surface, which is a separate question from this fixture set.
 *
 * The consequence is explicit: this suite grades the **legacy** dialect
 * against real markup and the **sdui** dialect only negatively (it must not
 * claim a legacy page).  A flip that breaks SDUI extraction alone is not
 * caught here.
 */

/** What `.measured.json` records about the live page, before scrubbing. */
interface Measured {
  readonly updateComponentsText: number;
  readonly dataIdUrn: number;
  readonly commentEntities: number;
  readonly socialCounts: number;
  readonly socialCountsText: string;
  readonly reactionsTriggerAria: string | null;
  readonly componentkey: number;
  readonly dataTestid: number;
  readonly sduiScreen: number;
  readonly feedSharedUpdate: number;
}

interface Sidecar {
  readonly label: string;
  readonly measured: Measured;
}

/**
 * The production comment scraper's own anchor, quoted from
 * `operations/get-post.ts` (`SCRAPE_COMMENTS_SCRIPT`).
 *
 * It is `componentkey`-bound — an SDUI attribute — which is why a legacy page
 * yields an empty comment list.  Restated here rather than imported because
 * that source is a template literal built for `Runtime.evaluate`, not an
 * exported selector; the coupling is asserted, not assumed, by
 * {@link Fixture.commentCardinal} being read off the same page.
 */
const PRODUCTION_COMMENT_ANCHOR = '[componentkey^="replaceableComment_"]';

interface Fixture {
  /** Sidecar `label`, and the file stem under `__fixtures__/legacy/`. */
  readonly label: string;
  /** What this fixture is FOR, in one line. */
  readonly role: string;
  /**
   * The post's own comment count, as the page renders it.
   *
   * Traced to the sidecar's `socialCountsText` — `"2 41 comments"` and `""` —
   * which {@link installFixture}'s consumers assert the live DOM still
   * matches, so this number is grounded in the page rather than declared.
   */
  readonly commentCardinal: number;
  /** Reactions, traced to the sidecar's `reactionsTriggerAria`. */
  readonly reactionCardinal: number;
}

const FIXTURES: readonly Fixture[] = [
  {
    label: "post-with-comments",
    role: "contradiction case — 41 comments rendered beside 40 comment entities",
    commentCardinal: 41,
    reactionCardinal: 2,
  },
  {
    label: "post-zero-comments",
    role: "legal-empty control — genuinely zero, and no cardinal contradicting it",
    commentCardinal: 0,
    reactionCardinal: 0,
  },
];

function fixturePath(label: string, ext: "html" | "measured.json"): string {
  return fileURLToPath(
    new URL(`../__fixtures__/legacy/${label}.${ext}`, import.meta.url),
  );
}

function readSidecar(label: string): Sidecar {
  return JSON.parse(
    readFileSync(fixturePath(label, "measured.json"), "utf8"),
  ) as Sidecar;
}

describe("post-detail fixture oracle (integration)", () => {
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

  const adapters = adaptersFor("post-detail");
  const detectionSource = buildDetectionSource(adapters);
  const readinessSource = buildReadinessPredicateSource(adapters);
  const extractionSource = buildPostDetailExtractionSource(adapters);

  /**
   * Install a captured page into the live document.
   *
   * @param label - Fixture file stem under `__fixtures__/legacy/`.
   */
  async function installFixture(label: string): Promise<void> {
    const html = readFileSync(fixturePath(label, "html"), "utf8");
    const { frameTree } = (await client.send("Page.getFrameTree", {})) as {
      frameTree: { frame: { id: string } };
    };
    await client.send("Page.setDocumentContent", {
      frameId: frameTree.frame.id,
      html,
    });
  }

  /** Count elements matching a selector on the installed page. */
  async function count(selector: string): Promise<number> {
    return client.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
    );
  }

  for (const fixture of FIXTURES) {
    describe(`${fixture.label} — ${fixture.role}`, () => {
      const sidecar = readSidecar(fixture.label);
      const measured = sidecar.measured;

      // ─────────────────────────────────────────────────────────────────────
      // CANARY — the discriminator every other test in this describe leans
      // on.  It grades the installed DOM against the numbers measured on the
      // live page BEFORE scrubbing, so a load that silently did nothing is
      // named as such rather than surfacing as "the adapter did not claim
      // the page".
      //
      // It mattered even more while the legacy assertions below were
      // `it.fails` (#872): such a block passes when its body fails for ANY
      // reason, so a fixture that never loaded went green everywhere.  They
      // are plain `it` now, so a dead load goes red — but red on every test
      // at once, which is exactly as uninformative.  This is what tells the
      // two apart.
      //
      // Asserting against the sidecar rather than against numbers read out of
      // the scrubbed file is the point — a disagreement is a finding about
      // the scrub, not a number to adjust (see `__fixtures__/README.md`).
      // ─────────────────────────────────────────────────────────────────────
      it("canary: the installed DOM matches its pre-scrub sidecar", async () => {
        await installFixture(fixture.label);

        expect(sidecar.label).toBe(fixture.label);
        expect({
          feedSharedUpdate: await count(".feed-shared-update-v2"),
          updateComponentsText: await count(".update-components-text"),
          dataIdUrn: await count('[data-id^="urn:li:"]'),
          commentEntities: await count('[data-id^="urn:li:comment:"]'),
          socialCounts: await count(".social-details-social-counts"),
        }).toEqual({
          feedSharedUpdate: measured.feedSharedUpdate,
          updateComponentsText: measured.updateComponentsText,
          dataIdUrn: measured.dataIdUrn,
          commentEntities: measured.commentEntities,
          socialCounts: measured.socialCounts,
        });
      });

      it("canary: the page still renders the counts its sidecar measured", async () => {
        await installFixture(fixture.label);

        // Whitespace-normalised: the live row is pretty-printed across a
        // dozen text nodes, and the sidecar records what a reader sees.
        const countsText = await client.evaluate<string>(`(() => {
          const el = document.querySelector('.social-details-social-counts');
          return el ? el.textContent.replace(/\\s+/g, ' ').trim() : "";
        })()`);
        const reactionsAria = await client.evaluate<string | null>(`(() => {
          const el = document.querySelector('.social-details-social-counts [aria-label]');
          return el ? el.getAttribute('aria-label') : null;
        })()`);

        expect(countsText).toBe(measured.socialCountsText);
        expect(reactionsAria).toBe(measured.reactionsTriggerAria);

        // ...and the cardinals this suite reasons about are the ones that row
        // carries, rather than numbers declared in the test table.  The two
        // fixtures ground the same claim through opposite evidence, and
        // collapsing them would lose the distinction the pair exists for: a
        // positive count is grounded in the text of a row that RENDERS it,
        // while zero is grounded in there being NO row at all — which is
        // precisely what makes it a legal empty rather than a contradicted
        // one.
        if (fixture.commentCardinal > 0) {
          expect(countsText).toContain(`${String(fixture.commentCardinal)} comments`);
          // The reaction cardinal gets the SAME treatment, and the asymmetry
          // it removes is worth naming: without this, a wrong
          // `reactionCardinal` still goes red — but only in the extraction
          // assertion, where the cheapest way to clear the red is to edit the
          // number to whatever the extractor returned, which makes that
          // assertion circular.  Pinning it to the sidecar here is what makes
          // "a disagreement is a finding about the fixture, not a number to
          // adjust" enforceable for both counters instead of one.
          expect(reactionsAria).toBe(
            `${String(fixture.reactionCardinal)} reactions`,
          );
        } else {
          expect(measured.socialCounts).toBe(0);
          expect(countsText).toBe("");
          expect(reactionsAria).toBeNull();
          expect(fixture.reactionCardinal).toBe(0);
        }
      });

      it("is a legacy capture: no SDUI anchor is present anywhere on it", async () => {
        await installFixture(fixture.label);

        expect({
          componentkey: await count("[componentkey]"),
          dataTestid: await count("[data-testid]"),
          sduiScreen: await count("[data-sdui-screen]"),
        }).toEqual({
          componentkey: measured.componentkey,
          dataTestid: measured.dataTestid,
          sduiScreen: measured.sduiScreen,
        });
        expect(measured.componentkey).toBe(0);
      });

      // ─────────────────────────────────────────────────────────────────────
      // THE MUTATION CHECK's anchor — a plain `it` that CALLS the generated
      // detection source.
      //
      // It carries the one claim that survived #872 being open AND being
      // fixed: the probe reports a count per registered adapter.  Deleting an
      // adapter's `detect` anchor leaves an empty selector, `querySelectorAll`
      // raises `SyntaxError`, and this goes RED.
      //
      // It had to be a plain `it` while the legacy assertions below were
      // `it.fails`: under a deleted anchor those kept passing — their bodies
      // merely failed for a new reason — so nothing else in this file would
      // have noticed.  Now that they are plain `it`, they go red on that
      // mutation too, and by the SAME mechanism: `selectionSource` is
      // embedded in all three generated scripts, so an empty selector raises
      // `SyntaxError` in every one of them and `CDPClient.evaluate` reports
      // each identically.  This test does NOT name the mutation more
      // precisely than its neighbours do — do not read it as doing so.
      //
      // What it still uniquely carries is the assertion below that the SDUI
      // adapter claims NOTHING here.  That is this file's only negative
      // grading of the other dialect, and it is the reason to keep this test
      // rather than fold it into the ones that follow.
      // ─────────────────────────────────────────────────────────────────────
      it("instrument: the detection probe reports one count per registered adapter", async () => {
        await installFixture(fixture.label);

        const detection = await client.evaluate<{
          matched: string[];
          probes: Record<string, number>;
        }>(detectionSource);

        expect(Object.keys(detection.probes).sort()).toEqual(
          [...variantNamesFor("post-detail")].sort(),
        );
        // The sdui adapter must never claim a legacy capture.  This is the
        // only grading this suite can give that dialect — see the coverage
        // gap in the file header.
        expect(detection.matched).not.toContain("sdui");
      });

      // ─────────────────────────────────────────────────────────────────────
      // The empty-vs-error contract, graded on this fixture's OWN cardinal.
      //
      // Green today, and it must stay green: the two fixtures are a pair and
      // are satisfied jointly or not at all (PRD NFR-2 silent-empty rate 0 /
      // NFR-3 legal-empty false-positive rate 0).  Optimising for the
      // contradiction case alone yields always-throw-on-empty and destroys a
      // legal outcome; optimising for the control alone restores the
      // silent-empty defect.
      //
      // `extractedCount` is a real read of the production comment scraper's
      // anchor against real captured markup — not a stub.  As measured today
      // it is 0 on BOTH fixtures, because that scraper is `componentkey`-
      // bound and these are legacy captures: the second half of the same
      // live defect.
      //
      // That observation is deliberately NOT pinned with an assertion.  The
      // verdict below is derived from BOTH halves of the observation, so this
      // test stays correct — and stays green — if the comment scraper is
      // later made variant-tolerant and begins finding the 40 entities on
      // `post-with-comments`.  Pinning `extractedCount` to 0 would leave an
      // undeclared tripwire in the path of whoever fixes that — the same
      // trap the legacy assertions below avoided by declaring themselves
      // `it.fails` until #872 landed.
      // ─────────────────────────────────────────────────────────────────────
      it("empty-vs-error: the corroborator's verdict on this page's own cardinal", async () => {
        await installFixture(fixture.label);

        const extractedCount = await count(PRODUCTION_COMMENT_ANCHOR);
        const observation = {
          surface: "post-detail",
          variant: "legacy",
          field: "comments",
          cardinalName: "commentCount",
          cardinal: fixture.commentCardinal,
          extractedCount,
        };

        if (extractedCount === 0 && fixture.commentCardinal > 0) {
          // NFR-2: the page renders 41 and the scrape found none.  The two
          // halves of one observation contradict each other, so this is not
          // evidence the post has no comments — it is evidence the selectors
          // no longer match, and it must raise rather than return a record no
          // caller can tell apart from a real empty one.
          expect(() => {
            assertCardinalCorroboration(observation);
          }).toThrow();
        } else {
          // NFR-3: nothing claimed, nothing found — the cardinal corroborates
          // the empty list, so this is a legal outcome and must return
          // normally.  This branch also covers a future variant-tolerant
          // scraper finding comments here: a non-empty list is never a
          // contradiction.
          expect(() => {
            assertCardinalCorroboration(observation);
          }).not.toThrow();
        }
      });

      // ─────────────────────────────────────────────────────────────────────
      // #872 — FIXED, and these two are the regression gate for it.
      //
      // The legacy adapter's detect anchor read `[data-id^="urn:li:activity:"]`
      // while the activity URN lives on `data-urn` — every `data-id` URN on a
      // real page is a `urn:li:comment:` entity — so a genuine legacy page was
      // reported unsupported and this adapter could not detect the pages it
      // exists to serve.
      //
      // They landed as `it.fails`, stating the CONTRACT rather than the
      // then-current behaviour, so that fixing the anchor turned them red and
      // the flip had to be acknowledged in a visible one-token diff instead of
      // being silently absorbed.  It did, and this is that acknowledgement:
      // `it.fails(` -> `it(`, no change to either body.  Asserting the broken
      // behaviour instead would have baked #872 into the oracle and made its
      // fix look like the defect.
      //
      // Nothing about them is legacy-to-#872 now — they are ordinary
      // assertions that the legacy dialect is claimed and scraped, and a
      // future anchor regression is what they exist to catch.
      // ─────────────────────────────────────────────────────────────────────
      it(
        "the legacy adapter claims the page and readiness goes green",
        async () => {
          await installFixture(fixture.label);

          const detection = await client.evaluate<{
            matched: string[];
            probes: Record<string, number>;
          }>(detectionSource);

          expect(detection.matched).toEqual(["legacy"]);
          expect(detection.probes["legacy"]).toBe(1);
          expect(await client.evaluate<boolean>(readinessSource)).toBe(true);
        },
      );

      it(
        "extraction returns a legacy record carrying the page's own text and counts",
        async () => {
          await installFixture(fixture.label);

          const record = await client.evaluate<{
            variant: string;
            authorName: string | null;
            authorProfileUrl: string | null;
            text: string | null;
            reactionCount: number;
            commentCount: number;
          } | null>(extractionSource);

          expect(record).not.toBeNull();
          expect(record?.variant).toBe("legacy");
          // Text is asserted non-empty rather than byte-exact: the prose is
          // deterministic lorem of the captured length, and pinning it would
          // make a re-harvest a test failure rather than a fixture update.
          expect(record?.text ?? "").not.toBe("");
          // The scrub replaces profile slugs with `test-person-N` and never
          // removes the `/in/` shape the adapters select on
          // (`__fixtures__/README.md`), so the author link is still a link.
          expect(record?.authorProfileUrl).toMatch(/\/in\/test-person-\d+/);
          expect(record?.authorName ?? "").not.toBe("");
          // Counts come off the row the canary above pinned to the sidecar.
          expect(record?.commentCount).toBe(fixture.commentCardinal);
          expect(record?.reactionCount).toBe(fixture.reactionCardinal);
        },
      );
    });
  }
});
