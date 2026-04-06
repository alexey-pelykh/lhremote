// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  describeE2E,
  forceStopInstance,
  launchApp,
  quitApp,
  resolveAccountId,
  retryAsync,
} from "@lhremote/core/testing";
import {
  type AppService,
  CDPClient,
  COMMENT_INPUT,
  COMMENT_SUBMIT_BUTTON,
  delay,
  discoverInstancePort,
  discoverTargets,
  FEED_POST_CONTAINER,
  LauncherService,
  REACTION_CELEBRATE,
  REACTION_FUNNY,
  REACTION_INSIGHTFUL,
  REACTION_LIKE,
  REACTION_LOVE,
  REACTION_SUPPORT,
  REACTION_TRIGGER,
  SELECTORS,
  startInstanceWithRecovery,
} from "@lhremote/core";

/**
 * Query the number of elements matching a CSS selector in the LinkedIn
 * WebView via CDP `Runtime.evaluate`.
 */
async function queryCount(
  client: CDPClient,
  selector: string,
): Promise<number> {
  return client.evaluate<number>(
    `document.querySelectorAll(${JSON.stringify(selector)}).length`,
  );
}

/**
 * Get the center coordinates of the first element matching `selector`.
 */
async function getCenter(
  client: CDPClient,
  selector: string,
): Promise<{ x: number; y: number } | null> {
  return client.evaluate<{ x: number; y: number } | null>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`,
  );
}

/**
 * Navigate the CDP client to a URL and wait for the page load event.
 */
async function navigateAndWait(
  client: CDPClient,
  url: string,
): Promise<void> {
  await client.send("Page.enable");
  try {
    const loadPromise = client.waitForEvent("Page.loadEventFired", 30_000);
    await client.navigate(url);
    await loadPromise;
  } finally {
    await client.send("Page.disable").catch(() => {});
  }
}

/** LinkedIn feed page URL. */
const FEED_URL = "https://www.linkedin.com/feed/";

describeE2E("LinkedIn selectors registry", () => {
  let app: AppService;
  let port: number;
  let accountId: number;
  let linkedInClient: CDPClient;

  beforeAll(async () => {
    // 1. Launch LinkedHelper
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    // 2. Start an account instance
    accountId = await resolveAccountId(port);

    const launcher = new LauncherService(port);
    await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
    await startInstanceWithRecovery(launcher, accountId, port);
    launcher.disconnect();

    // 3. Discover the instance's CDP port
    const instancePort = await retryAsync(
      async () => {
        const p = await discoverInstancePort(port);
        if (p === null) throw new Error("Instance CDP port not discovered yet");
        return p;
      },
      { retries: 10, delay: 2_000 },
    );

    // 4. Connect directly to the LinkedIn WebView target
    const liTarget = await retryAsync(
      async () => {
        const t = await discoverTargets(instancePort);
        const li = t.find(
          (tgt) =>
            tgt.type === "page" && tgt.url.includes("linkedin.com"),
        );
        if (!li) throw new Error("LinkedIn target not found yet");
        return li;
      },
      { retries: 10, delay: 2_000 },
    );

    linkedInClient = new CDPClient(instancePort);
    await linkedInClient.connect(liTarget.id);

    // 5. Navigate to the feed page and wait for it to load
    await navigateAndWait(linkedInClient, FEED_URL);

    // Give the SPA a moment to render dynamic content
    await delay(3_000);
  }, 180_000);

  afterAll(async () => {
    linkedInClient?.disconnect();

    const launcher = new LauncherService(port);
    try {
      await launcher.connect();
      await forceStopInstance(launcher, accountId, port);
    } catch {
      // Best-effort cleanup
    } finally {
      launcher.disconnect();
    }

    await quitApp(app);
  }, 60_000);

  // -- Module export sanity checks -----------------------------------------

  describe("module exports", () => {
    it("SELECTORS object contains all expected keys", () => {
      const expectedKeys: string[] = [
        "FEED_POST_CONTAINER",
        "COMMENT_INPUT",
        "REACTION_TRIGGER",
        "REACTION_LIKE",
        "REACTION_CELEBRATE",
        "REACTION_SUPPORT",
        "REACTION_LOVE",
        "REACTION_INSIGHTFUL",
        "REACTION_FUNNY",
        "COMMENT_SUBMIT_BUTTON",
      ];

      for (const key of expectedKeys) {
        expect(SELECTORS).toHaveProperty(key);
        expect(
          typeof SELECTORS[key as keyof typeof SELECTORS],
          `${key} should be a non-empty string`,
        ).toBe("string");
        expect(
          (SELECTORS[key as keyof typeof SELECTORS] as string).length,
          `${key} should not be empty`,
        ).toBeGreaterThan(0);
      }
    });
  });

  // -- Feed page selectors -------------------------------------------------

  describe("feed page selectors", () => {
    it("FEED_POST_CONTAINER matches at least one element", async () => {
      const count = await queryCount(linkedInClient, FEED_POST_CONTAINER);
      expect(count, `Selector "${FEED_POST_CONTAINER}" matched 0 elements`).toBeGreaterThan(0);
    });

    it("REACTION_TRIGGER matches at least one element", async () => {
      const count = await queryCount(linkedInClient, REACTION_TRIGGER);
      expect(count, `Selector "${REACTION_TRIGGER}" matched 0 elements`).toBeGreaterThan(0);
    });
  });

  // -- Reactions popup selectors (hover-triggered) -------------------------

  describe("reactions popup selectors", () => {
    beforeAll(async () => {
      // Hover over the first reaction trigger using CDP Input events
      // to reveal the reactions popup
      const center = await getCenter(linkedInClient, REACTION_TRIGGER);
      if (!center) throw new Error("Reaction trigger not found for hover");
      await linkedInClient.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: center.x,
        y: center.y,
      });
      // Wait for the popup to render (~3s for LinkedIn's animation)
      await delay(3_000);
    });

    it("REACTION_LIKE matches at least one element", async () => {
      const count = await queryCount(linkedInClient, REACTION_LIKE);
      expect(count, `Selector "${REACTION_LIKE}" matched 0 elements`).toBeGreaterThan(0);
    });

    it("REACTION_CELEBRATE matches at least one element", async () => {
      const count = await queryCount(linkedInClient, REACTION_CELEBRATE);
      expect(count, `Selector "${REACTION_CELEBRATE}" matched 0 elements`).toBeGreaterThan(0);
    });

    it("REACTION_SUPPORT matches at least one element", async () => {
      const count = await queryCount(linkedInClient, REACTION_SUPPORT);
      expect(count, `Selector "${REACTION_SUPPORT}" matched 0 elements`).toBeGreaterThan(0);
    });

    it("REACTION_LOVE matches at least one element", async () => {
      const count = await queryCount(linkedInClient, REACTION_LOVE);
      expect(count, `Selector "${REACTION_LOVE}" matched 0 elements`).toBeGreaterThan(0);
    });

    it("REACTION_INSIGHTFUL matches at least one element", async () => {
      const count = await queryCount(linkedInClient, REACTION_INSIGHTFUL);
      expect(count, `Selector "${REACTION_INSIGHTFUL}" matched 0 elements`).toBeGreaterThan(0);
    });

    it("REACTION_FUNNY matches at least one element", async () => {
      const count = await queryCount(linkedInClient, REACTION_FUNNY);
      expect(count, `Selector "${REACTION_FUNNY}" matched 0 elements`).toBeGreaterThan(0);
    });
  });

  // -- Comment selectors (click-triggered) ---------------------------------

  describe("comment selectors", () => {
    /** The Comment button in the social bar has no aria-label; match by text. */
    const COMMENT_BUTTON_JS = `
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Comment")
    `;

    beforeAll(async () => {
      // Dismiss the reactions popup by clicking elsewhere
      await linkedInClient.evaluate("document.body.click()");
      await delay(500);

      // Click the "Comment" button on the first post to expand the section
      await linkedInClient.evaluate(
        `(() => { const btn = ${COMMENT_BUTTON_JS}; if (btn) btn.click(); })()`,
      );
      await delay(1_500);
    });

    it("COMMENT_INPUT matches at least one element", async () => {
      const count = await queryCount(linkedInClient, COMMENT_INPUT);
      expect(count, `Selector "${COMMENT_INPUT}" matched 0 elements`).toBeGreaterThan(0);
    });

    it("COMMENT_SUBMIT_BUTTON matches at least one element", async () => {
      // The submit button appears after typing into the editor
      await linkedInClient.evaluate(
        `(() => {
          const editor = document.querySelector(${JSON.stringify(COMMENT_INPUT)});
          if (editor) {
            editor.focus();
            editor.textContent = ' ';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()`,
      );
      await delay(1_000);

      const count = await queryCount(linkedInClient, COMMENT_SUBMIT_BUTTON);
      expect(count, `Selector "${COMMENT_SUBMIT_BUTTON}" matched 0 elements`).toBeGreaterThan(0);

      // Clean up: clear the editor text
      await linkedInClient.evaluate(
        `(() => {
          const editor = document.querySelector(${JSON.stringify(COMMENT_INPUT)});
          if (editor) {
            editor.textContent = '';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()`,
      );
    });
  });
});
