// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CDPClient } from "../../cdp/client.js";
import {
  EMPTY_DOCUMENT_HTML,
  INSTALL_TEST_TIMEOUT_MS,
  installDocument,
} from "../../cdp/testing/install-document.js";
import {
  launchChromium,
  type ChromiumInstance,
} from "../../cdp/testing/launch-chromium.js";
import {
  adaptersFor,
  buildDetectionSource,
  buildPostDetailExtractionSource,
  buildReadinessPredicateSource,
} from "../dom-variant.js";

/** Timeout for beforeEach operations (connect + reset) on slow CI runners. */
const BEFORE_EACH_TIMEOUT = 15_000;

/**
 * Integration tier for the adapter registry.
 *
 * The unit tier grades these scripts against a hand-rolled stand-in for
 * `document`, which cannot prove the emitted source is valid in a browser or
 * that real `querySelector` semantics agree with the stand-in.  This tier
 * runs the *same generated strings* through `Runtime.evaluate` in headless
 * Chromium against DOM built with real DOM APIs.
 *
 * It deliberately does NOT assert extracted field values against harvested
 * LinkedIn markup — that needs real captured pages and is the fixture
 * oracle's job.  What it asserts is *selection* — which adapter claims a
 * page, and what happens when none or several do — plus the reads whose
 * answer only a real browser can settle, against DOM built here: how sibling
 * elements' text concatenates, whether `aria-label` carries a count the text
 * omits, and CSS selector-list semantics.  Those cases are graded in the unit
 * tier too, against a hand-rolled stand-in; the duplication is the point,
 * because it is the stand-in's fidelity that is in question.
 */
describe("DOM variant adapters (integration)", { timeout: INSTALL_TEST_TIMEOUT_MS }, () => {
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
    // The document is replaced through CDP rather than drained from JS: the
    // drain dereferenced `document.body` before the freshly-launched target
    // had one, which is #866.  Installing a document also *creates* the body,
    // so everything below can rely on it existing.  innerHTML stays
    // unavailable either way (Trusted Types), so elements are still built
    // through DOM APIs.  The shared helper is what makes "installed" mean
    // "observable by the next `evaluate`" -- see `installDocument` (#888).
    await installDocument(client, EMPTY_DOCUMENT_HTML);
  }, INSTALL_TEST_TIMEOUT_MS);

  afterEach(() => {
    client.disconnect();
  });

  const adapters = adaptersFor("post-detail");
  const [sdui, legacy] = adapters;

  /**
   * Build a `<main>` containing an author link — i.e. everything the OLD gate
   * and the OLD scope cascade needed to declare success — plus whatever
   * dialect-specific container the test asks for.
   *
   * `<main>` and the author link are present in EVERY case on purpose: they
   * are the always-true terminal the cascade used to land on, so their
   * presence is what makes "returns nothing" a meaningful assertion rather
   * than a vacuous one.
   */
  async function buildPage(
    containers: readonly { attr: string; value: string }[],
  ): Promise<void> {
    const spec = JSON.stringify(containers);
    await client.evaluate(`(() => {
      const main = document.createElement('main');
      const chrome = document.createElement('a');
      chrome.setAttribute('href', 'https://www.linkedin.com/in/premium-upsell/');
      chrome.textContent = 'Premium';
      main.appendChild(chrome);
      for (const c of ${spec}) {
        const container = document.createElement('div');
        container.setAttribute(c.attr, c.value);
        const author = document.createElement('a');
        author.setAttribute('href', 'https://www.linkedin.com/in/real-author/');
        author.textContent = 'Real Author';
        container.appendChild(author);
        main.appendChild(container);
      }
      document.body.appendChild(main);
      return true;
    })()`);
  }

  const SDUI_CONTAINER = {
    attr: "componentkey",
    value: "expanded1234FeedType_FEED_DETAIL",
  };
  // Hand-written on purpose, and NOT sourced from the adapter: deriving it
  // would make this tier assert against markup authored from the very anchor
  // under test.  It carried the same wrong belief the anchor did until #872 —
  // the activity URN lives on `data-urn`; `data-id` on a real legacy page
  // carries `urn:li:comment:` entities only.
  const LEGACY_CONTAINER = {
    attr: "data-urn",
    value: "urn:li:activity:7436698865522851840",
  };
  const SDUI_SCREEN = {
    attr: "data-sdui-screen",
    value: "com.linkedin.sdui.flagshipnav.feed.UpdateDetail",
  };
  // A `data-urn` whose URN is NOT an activity.  A comment URN is the value
  // that makes this page realistic rather than contrived: on the captured
  // legacy page every non-activity URN is a `urn:li:comment:` entity (#872),
  // and a comment sits INSIDE the update carrying its own author link.  It
  // also starts with `urn:li:` without starting with `urn:li:activity:`,
  // which is what separates the shipped anchor from both of the widenings
  // that would otherwise pass green.
  const LEGACY_COMMENT_CONTAINER = {
    attr: "data-urn",
    value:
      "urn:li:comment:(urn:li:activity:7436698865522851840,7436707959465730049)",
  };

  describe("readiness predicate", () => {
    const predicate = buildReadinessPredicateSource(adapters);

    it("stays red on a page with <main> and an author link but no dialect container", async () => {
      // This is the exact page shape the old gate went green on: `main
      // a[href*="/in/"]` matches, so the old three-stage predicate passed and
      // extraction ran against a scope whose field selectors matched nothing.
      await buildPage([]);

      expect(await client.evaluate<boolean>(predicate)).toBe(false);
    });

    it("goes green on an sdui page", async () => {
      await buildPage([SDUI_CONTAINER]);

      expect(await client.evaluate<boolean>(predicate)).toBe(true);
    });

    it("goes green on a legacy page", async () => {
      await buildPage([LEGACY_CONTAINER]);

      expect(await client.evaluate<boolean>(predicate)).toBe(true);
    });

    it("stays red when the container is present but the post body has not hydrated", async () => {
      // Container without the author link inside it: the dialect is
      // identifiable but the body is still a skeleton.  Gating on the
      // container alone would let extraction run here and hand back an empty
      // record, which is the failure mode being removed.
      await client.evaluate(`(() => {
        const main = document.createElement('main');
        const chrome = document.createElement('a');
        chrome.setAttribute('href', 'https://www.linkedin.com/in/premium-upsell/');
        main.appendChild(chrome);
        const container = document.createElement('div');
        container.setAttribute('componentkey', 'expanded1234FeedType_FEED_DETAIL');
        main.appendChild(container);
        document.body.appendChild(main);
        return true;
      })()`);

      expect(await client.evaluate<boolean>(predicate)).toBe(false);
    });

    it("stays red on a hybrid page claimed by both dialects", async () => {
      await buildPage([SDUI_CONTAINER, LEGACY_CONTAINER]);

      expect(await client.evaluate<boolean>(predicate)).toBe(false);
    });

    it("goes green on the sdui screen fallback when the container prefix is gone", async () => {
      // The tolerance the pre-registry cascade had for the `expanded` prefix
      // being renamed. Graded in a real browser because both `detect` and
      // `ready` are CSS selector LISTS here, and list semantics are exactly
      // what a hand-rolled document double cannot certify.
      await buildPage([SDUI_SCREEN]);

      expect(await client.evaluate<boolean>(predicate)).toBe(true);
    });
  });

  describe("detection probe", () => {
    const probe = buildDetectionSource(adapters);

    it("reports zero matches with per-variant counts on an unknown dialect", async () => {
      await buildPage([]);

      const detection = await client.evaluate<{
        matched: string[];
        probes: Record<string, number>;
      }>(probe);

      expect(detection.matched).toEqual([]);
      expect(detection.probes).toEqual({ sdui: 0, legacy: 0 });
    });

    it("reports both claimants on a hybrid page", async () => {
      await buildPage([SDUI_CONTAINER, LEGACY_CONTAINER]);

      const detection = await client.evaluate<{ matched: string[] }>(probe);

      expect(detection.matched).toEqual(["sdui", "legacy"]);
    });

    it("reports zero matches when the only data-urn is not an activity URN", async () => {
      // The `activity:` half of the legacy detect anchor, which nothing else
      // grades (#878).  Both committed fixtures carry exactly one `data-urn`
      // and it is an activity URN, so widening the anchor to `[data-urn]` or
      // to `[data-urn^="urn:li:"]` leaves the fixture oracle green -- each of
      // the three still matches exactly 1 there.  Only a page whose `data-urn`
      // is NOT an activity separates them, and under either widening this one
      // is claimed by `legacy`: a COMMENT would become the post, which is the
      // cross-entity blending the registry exists to make impossible.
      //
      // Graded in a real browser rather than in the unit tier because that
      // tier's document double compares selector STRINGS and never evaluates
      // `^=`, so it cannot tell the shipped anchor from either widening.
      await buildPage([LEGACY_COMMENT_CONTAINER]);

      // Guard on the premise: the element really is on the page carrying the
      // attribute.  Without this, the zero below is also what a page that
      // failed to build reports -- a green that pins nothing.
      expect(
        await client.evaluate<number>(
          `document.querySelectorAll('[data-urn]').length`,
        ),
      ).toBe(1);

      const detection = await client.evaluate<{
        matched: string[];
        probes: Record<string, number>;
      }>(probe);

      expect(detection.matched).toEqual([]);
      expect(detection.probes).toEqual({ sdui: 0, legacy: 0 });
    });
  });

  describe("post-detail extraction", () => {
    const script = buildPostDetailExtractionSource(adapters);

    it("returns null on a page with <main> — the terminal fallback is gone", async () => {
      // The headline acceptance criterion, graded in a real browser: `<main>`
      // exists, an author link inside it exists, and extraction still yields
      // nothing.  Before this change the cascade landed on `<main>` and
      // returned a record whose author was the Premium upsell banner.
      await buildPage([]);

      expect(await client.evaluate<unknown>(script)).toBeNull();
      // ...and `<main>` really is on the page, so the null is a refusal
      // rather than an empty document.
      expect(
        await client.evaluate<boolean>(
          `document.querySelector('main a[href*="/in/"]') !== null`,
        ),
      ).toBe(true);
    });

    it("selects sdui and tags the record on an sdui page", async () => {
      await buildPage([SDUI_CONTAINER]);

      const result = await client.evaluate<{
        variant: string;
        authorProfileUrl: string | null;
      }>(script);

      expect(result.variant).toBe("sdui");
      // Scoped to the adapter's own container, so the Premium upsell anchor
      // sitting in <main> is not picked up as the author.
      expect(result.authorProfileUrl).toBe(
        "https://www.linkedin.com/in/real-author/",
      );
    });

    it("selects legacy and tags the record on a legacy page", async () => {
      await buildPage([LEGACY_CONTAINER]);

      const result = await client.evaluate<{
        variant: string;
        authorProfileUrl: string | null;
      }>(script);

      expect(result.variant).toBe("legacy");
      expect(result.authorProfileUrl).toBe(
        "https://www.linkedin.com/in/real-author/",
      );
    });

    it("refuses to pick on a hybrid page", async () => {
      await buildPage([SDUI_CONTAINER, LEGACY_CONTAINER]);

      const result = await client.evaluate<{ ambiguousVariants: string[] }>(
        script,
      );

      expect(result.ambiguousVariants).toEqual(["sdui", "legacy"]);
    });

    it("reads each counter from the element that renders it (#836)", async () => {
      // The counts row exactly as it rendered live on 2026-08-31: "2"
      // reactions — a bare number whose words live only in the control's
      // aria-label — beside "41 comments".  A reader sees "2 41 comments";
      // the concatenation the previous whole-page read consumed sees
      // "241 comments".  Only a real browser can settle which of the two a
      // given markup shape actually produces, which is why this assertion is
      // here and not in the unit tier.
      await buildPage([LEGACY_CONTAINER]);
      await client.evaluate(`(() => {
        const container = document.querySelector('[data-urn^="urn:li:activity:"]');
        const row = document.createElement('div');
        row.className = 'social-details-social-counts';
        const reactions = document.createElement('button');
        reactions.setAttribute('aria-label', '2 reactions');
        const reactionsValue = document.createElement('span');
        reactionsValue.textContent = '2';
        reactions.appendChild(reactionsValue);
        const comments = document.createElement('button');
        comments.setAttribute('aria-label', '41 comments');
        comments.textContent = '41 comments';
        row.appendChild(reactions);
        row.appendChild(comments);
        container.appendChild(row);
        return true;
      })()`);

      // Guard on the premise: the two counters really do concatenate with no
      // separator in a real DOM.  Without this the assertions below could be
      // grading a page shape that never produced the defect.
      expect(
        await client.evaluate<string>(
          `document.querySelector('.social-details-social-counts').textContent`,
        ),
      ).toBe("241 comments");

      const result = await client.evaluate<{
        reactionCount: number;
        commentCount: number;
      }>(script);

      expect(result.commentCount).toBe(41);
      expect(result.reactionCount).toBe(2);
    });

    it("reads a counts row that renders both counters as one node (#836)", async () => {
      // The same criterion string against a row built the other way: one
      // element whose whole text is "2 41 comments".  Nothing inside it
      // renders a counter on its own, so the anchored read finds none — and
      // reporting zero comments for a row that visibly says "41 comments"
      // would be the same class of wrong the whole-page read was.  Inside a
      // row the adapter itself declared, the looser read recovers 41.
      await buildPage([LEGACY_CONTAINER]);
      await client.evaluate(`(() => {
        const container = document.querySelector('[data-urn^="urn:li:activity:"]');
        const row = document.createElement('div');
        row.className = 'social-details-social-counts';
        row.textContent = '2 41 comments';
        container.appendChild(row);
        return true;
      })()`);

      const result = await client.evaluate<{
        reactionCount: number;
        commentCount: number;
      }>(script);

      // 0 reactions is the honest answer, not a miss: this rendering carries
      // no "reactions" token anywhere for a read to find.
      expect(result.commentCount).toBe(41);
      expect(result.reactionCount).toBe(0);
    });

    it("ignores a counter rendered outside the selected adapter's scope", async () => {
      // The whole-page read took the first "<N> comments"-shaped run anywhere
      // in the document, chrome and sibling modules included.  A count from
      // outside the post is not the post's count.
      await buildPage([LEGACY_CONTAINER]);
      await client.evaluate(`(() => {
        const stray = document.createElement('span');
        stray.textContent = '999 comments';
        document.body.appendChild(stray);
        return true;
      })()`);

      const result = await client.evaluate<{ commentCount: number }>(script);

      expect(result.commentCount).toBe(0);
    });

    it("reads the author's name once and the headline as the headline (#836)", async () => {
      // The legacy actor block writes each field twice inside the anchor —
      // the copy a reader sees, wrapped in aria-hidden="true", and an
      // assistive-technology twin beside it — with span[dir="ltr"] wrapping
      // the PAIR.  Reading that wrapper returned the name doubled and pushed
      // the plain name into the headline.
      await client.evaluate(`(() => {
        function pair(text) {
          const outer = document.createElement('span');
          const visible = document.createElement('span');
          visible.setAttribute('aria-hidden', 'true');
          visible.textContent = text;
          const twin = document.createElement('span');
          twin.textContent = text;
          outer.appendChild(visible);
          outer.appendChild(twin);
          return outer;
        }
        const main = document.createElement('main');
        const container = document.createElement('div');
        container.setAttribute('data-urn', 'urn:li:activity:7436698865522851840');
        const anchor = document.createElement('a');
        anchor.setAttribute('href', 'https://www.linkedin.com/in/alexey-pelykh/');
        const title = pair('Alexey Pelykh');
        title.setAttribute('dir', 'ltr');
        anchor.appendChild(title);
        anchor.appendChild(pair('Software Architect | Agentic AI'));
        container.appendChild(anchor);
        main.appendChild(container);
        document.body.appendChild(main);
        return true;
      })()`);

      // Guard on the premise: the anchor's own text really is the two fields
      // with both copies of each run together, which is the shape measured
      // live.
      expect(
        await client.evaluate<string>(
          `document.querySelector('[data-urn^="urn:li:activity:"] a').textContent`,
        ),
      ).toBe(
        "Alexey PelykhAlexey PelykhSoftware Architect | Agentic AISoftware Architect | Agentic AI",
      );

      const result = await client.evaluate<{
        authorName: string | null;
        authorHeadline: string | null;
      }>(script);

      expect(result.authorName).toBe("Alexey Pelykh");
      expect(result.authorHeadline).toBe("Software Architect | Agentic AI");
    });

    it("extracts post text through the selected adapter's own field selectors", async () => {
      // Not a fixture assertion: the container is synthetic.  What it proves
      // is that the adapter's extractor actually runs against the scope the
      // registry resolved, in a real browser, rather than merely parsing.
      await buildPage([SDUI_CONTAINER]);
      await client.evaluate(`(() => {
        const container = document.querySelector('[componentkey^="expanded"]');
        const body = document.createElement('span');
        body.setAttribute('data-testid', 'expandable-text-box');
        body.textContent = 'Monday starts with a test';
        container.appendChild(body);
        return true;
      })()`);

      const result = await client.evaluate<{ text: string | null }>(script);

      expect(result.text).toBe("Monday starts with a test");
    });
  });

  it("registers a third adapter without any call-site change", async () => {
    // Same production generator, one extra row, a dialect no source file
    // mentions.  Selection, readiness and extraction all follow.
    const third = {
      surface: "post-detail" as const,
      variant: "hypothetical",
      detect: '[data-hypothetical-post="1"]',
      ready: '[data-hypothetical-post="1"] a[href*="/in/"]',
      scopes: ['[data-hypothetical-post="1"]'],
      counts: [],
      extract: `(function (scope) {
        const a = scope.querySelector('a[href*="/in/"]');
        return {
          authorName: a ? a.textContent : null,
          authorHeadline: null,
          authorProfileUrl: a ? a.href : null,
          text: null,
          timestamp: null,
        };
      })`,
    };
    const extended = [...adapters, third];
    await buildPage([{ attr: "data-hypothetical-post", value: "1" }]);

    expect(
      await client.evaluate<boolean>(buildReadinessPredicateSource(extended)),
    ).toBe(true);
    const result = await client.evaluate<{
      variant: string;
      authorName: string | null;
    }>(buildPostDetailExtractionSource(extended));
    expect(result.variant).toBe("hypothetical");
    expect(result.authorName).toBe("Real Author");
    // The previously-registered dialects are untouched by the addition.
    expect(sdui?.variant).toBe("sdui");
    expect(legacy?.variant).toBe("legacy");
  });
});
