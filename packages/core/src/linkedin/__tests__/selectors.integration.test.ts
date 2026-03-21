// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CDPClient } from "../../cdp/client.js";
import { discoverTargets } from "../../cdp/discovery.js";
import {
  discoverInstancePort,
  killInstanceProcesses,
} from "../../cdp/instance-discovery.js";
import type { AppService } from "../../services/app.js";
import {
  startInstanceWithRecovery,
  waitForInstanceShutdown,
} from "../../services/instance-lifecycle.js";
import { LauncherService } from "../../services/launcher.js";
import {
  describeE2E,
  launchApp,
  quitApp,
  retryAsync,
} from "../../testing/e2e-helpers.js";
import type { Account } from "../../types/account.js";
import { delay } from "../../utils/delay.js";
import {
  COMMENT_INPUT,
  COMMENT_SUBMIT_BUTTON,
  FEED_POST_CONTAINER,
  PAGINATION_TRIGGER,
  POST_AUTHOR_INFO,
  POST_AUTHOR_NAME,
  POST_TEXT_CONTENT,
  REACTION_CELEBRATE,
  REACTION_FUNNY,
  REACTION_INSIGHTFUL,
  REACTION_LIKE,
  REACTION_LOVE,
  REACTION_SUPPORT,
  REACTION_TRIGGER,
  REACTIONS_MENU,
  SCROLL_CONTAINER,
  SELECTORS,
} from "../selectors.js";

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
 * Dispatch a `mouseenter` + `mouseover` sequence on the first element
 * matching `selector` to trigger hover-dependent UI (e.g. reactions menu).
 */
async function hoverFirst(
  client: CDPClient,
  selector: string,
): Promise<void> {
  await client.evaluate(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return;
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    })()`,
  );
}

/**
 * Click the first element matching `selector`.
 */
async function clickFirst(
  client: CDPClient,
  selector: string,
): Promise<void> {
  await client.evaluate(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) el.click();
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

/** Selector for the "Comment" button in the social action bar. */
const COMMENT_BUTTON = 'button[aria-label*="Comment" i]';

describeE2E("LinkedIn selectors registry", () => {
  let app: AppService;
  let launcherPort: number;
  let accountId: number | undefined;
  let linkedInClient: CDPClient;

  beforeAll(async () => {
    // 1. Launch LinkedHelper
    const launched = await launchApp();
    app = launched.app;
    launcherPort = launched.port;

    // 2. Start an account instance
    const launcher = new LauncherService(launcherPort);
    await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
    const accounts = await launcher.listAccounts();
    expect(
      accounts.length,
      "No accounts configured in LinkedHelper",
    ).toBeGreaterThan(0);
    accountId = (accounts[0] as Account).id;
    await startInstanceWithRecovery(launcher, accountId, launcherPort);
    launcher.disconnect();

    // 3. Discover the instance's CDP port
    const instancePort = await discoverInstancePort(launcherPort);
    if (instancePort === null) {
      throw new Error("Instance CDP port not discovered");
    }

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

    if (accountId !== undefined) {
      const launcher = new LauncherService(launcherPort);
      try {
        await launcher.connect();
        try {
          await launcher.stopInstance(accountId);
          await waitForInstanceShutdown(launcherPort);
        } catch {
          await killInstanceProcesses(launcherPort);
        }
      } catch {
        // Best-effort cleanup
      } finally {
        launcher.disconnect();
      }
    }

    await quitApp(app);
  }, 60_000);

  // ── Module export sanity checks ─────────────────────────────────

  describe("module exports", () => {
    it("SELECTORS object contains all expected keys", () => {
      const expectedKeys: string[] = [
        "FEED_POST_CONTAINER",
        "POST_TEXT_CONTENT",
        "POST_AUTHOR_NAME",
        "POST_AUTHOR_INFO",
        "COMMENT_INPUT",
        "REACTION_TRIGGER",
        "REACTIONS_MENU",
        "REACTION_LIKE",
        "REACTION_CELEBRATE",
        "REACTION_SUPPORT",
        "REACTION_LOVE",
        "REACTION_INSIGHTFUL",
        "REACTION_FUNNY",
        "COMMENT_SUBMIT_BUTTON",
        "SCROLL_CONTAINER",
        "PAGINATION_TRIGGER",
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

  // ── Feed page selectors ─────────────────────────────────────────

  describe("feed page selectors", () => {
    it("FEED_POST_CONTAINER matches at least one element", async () => {
      const count = await queryCount(linkedInClient, FEED_POST_CONTAINER);
      expect(count, `Selector "${FEED_POST_CONTAINER}" matched 0 elements`).toBeGreaterThan(0);
    });

    it("POST_TEXT_CONTENT matches at least one element", async () => {
      const count = await queryCount(linkedInClient, POST_TEXT_CONTENT);
      expect(count, `Selector "${POST_TEXT_CONTENT}" matched 0 elements`).toBeGreaterThan(0);
    });

    it("POST_AUTHOR_NAME matches at least one element", async () => {
      const count = await queryCount(linkedInClient, POST_AUTHOR_NAME);
      expect(count, `Selector "${POST_AUTHOR_NAME}" matched 0 elements`).toBeGreaterThan(0);
    });

    it("POST_AUTHOR_INFO matches at least one element", async () => {
      const count = await queryCount(linkedInClient, POST_AUTHOR_INFO);
      expect(count, `Selector "${POST_AUTHOR_INFO}" matched 0 elements`).toBeGreaterThan(0);
    });

    it("REACTION_TRIGGER matches at least one element", async () => {
      const count = await queryCount(linkedInClient, REACTION_TRIGGER);
      expect(count, `Selector "${REACTION_TRIGGER}" matched 0 elements`).toBeGreaterThan(0);
    });

    it("SCROLL_CONTAINER matches at least one element", async () => {
      const count = await queryCount(linkedInClient, SCROLL_CONTAINER);
      expect(count, `Selector "${SCROLL_CONTAINER}" matched 0 elements`).toBeGreaterThan(0);
    });
  });

  // ── Reactions menu selectors (hover-triggered) ──────────────────

  describe("reactions menu selectors", () => {
    beforeAll(async () => {
      // Hover over the first reaction trigger to reveal the reactions menu
      await hoverFirst(linkedInClient, REACTION_TRIGGER);
      // Wait for the popup to render
      await delay(1_500);
    });

    it("REACTIONS_MENU matches at least one element", async () => {
      const count = await queryCount(linkedInClient, REACTIONS_MENU);
      expect(count, `Selector "${REACTIONS_MENU}" matched 0 elements`).toBeGreaterThan(0);
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

  // ── Comment selectors (click-triggered) ─────────────────────────

  describe("comment selectors", () => {
    beforeAll(async () => {
      // Dismiss the reactions menu by clicking elsewhere
      await clickFirst(linkedInClient, "body");
      await delay(500);

      // Click the "Comment" button on the first post to expand the section
      await clickFirst(linkedInClient, COMMENT_BUTTON);
      await delay(1_500);
    });

    it("COMMENT_INPUT matches at least one element", async () => {
      const count = await queryCount(linkedInClient, COMMENT_INPUT);
      expect(count, `Selector "${COMMENT_INPUT}" matched 0 elements`).toBeGreaterThan(0);
    });

    it("COMMENT_SUBMIT_BUTTON matches at least one element", async () => {
      // The submit button only appears after typing into the editor
      await linkedInClient.evaluate(
        `(() => {
          const editor = document.querySelector(${JSON.stringify(COMMENT_INPUT)});
          if (editor) {
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

  // ── Pagination trigger ──────────────────────────────────────────

  describe("pagination selectors", () => {
    it("PAGINATION_TRIGGER matches at least one element after scrolling", async () => {
      // Scroll to the bottom to trigger pagination rendering
      await linkedInClient.evaluate(
        "window.scrollTo(0, document.body.scrollHeight)",
      );
      await delay(3_000);

      const count = await queryCount(linkedInClient, PAGINATION_TRIGGER);
      expect(count, `Selector "${PAGINATION_TRIGGER}" matched 0 elements`).toBeGreaterThan(0);
    });
  });
});
