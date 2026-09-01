// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CDPClient } from "../../cdp/client.js";
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
 * oracle's job.  What it asserts is *selection*: which adapter claims a page,
 * and what happens when none or several do.
 */
describe("DOM variant adapters (integration)", () => {
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
    // innerHTML is blocked by Chromium's Trusted Types policy, so the page is
    // torn down and rebuilt through DOM APIs.
    await client.evaluate(
      `while (document.body.firstChild) document.body.removeChild(document.body.firstChild)`,
    );
  }, BEFORE_EACH_TIMEOUT);

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
  const LEGACY_CONTAINER = {
    attr: "data-id",
    value: "urn:li:activity:7436698865522851840",
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

    it("parses engagement counts from body text independently of the dialect", async () => {
      await buildPage([SDUI_CONTAINER]);
      await client.evaluate(`(() => {
        const counts = document.createElement('span');
        counts.textContent = '1,234 reactions 41 comments 7 reposts';
        document.body.appendChild(counts);
        return true;
      })()`);

      const result = await client.evaluate<{
        reactionCount: number;
        commentCount: number;
        shareCount: number;
      }>(script);

      expect(result.reactionCount).toBe(1234);
      expect(result.commentCount).toBe(41);
      expect(result.shareCount).toBe(7);
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
