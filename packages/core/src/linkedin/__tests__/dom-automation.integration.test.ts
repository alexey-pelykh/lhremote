// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CDPClient } from "../../cdp/client.js";
import { CDPEvaluationError, CDPTimeoutError } from "../../cdp/errors.js";
import {
  EMPTY_DOCUMENT_HTML,
  INSTALL_TEST_TIMEOUT_MS,
  installDocument,
} from "../../cdp/testing/install-document.js";
import {
  launchChromium,
  type ChromiumInstance,
} from "../../cdp/testing/launch-chromium.js";
import { click, scrollTo, typeText, waitForElement } from "../dom-automation.js";

/** Timeout for beforeEach operations (connect + reset) on slow CI runners. */
const BEFORE_EACH_TIMEOUT = 15_000;

describe("DOM automation (integration)", { timeout: INSTALL_TEST_TIMEOUT_MS }, () => {
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
    // Reset through the shared install gate rather than by draining
    // `document.body` from JS.  The drain dereferenced `document.body` before
    // the freshly-launched target had one -- null on the slowest runner in the
    // matrix, which is the whole of #866; installing a document *creates* the
    // body instead, so everything below can rely on it existing.  `innerHTML`
    // stays unavailable either way (Trusted Types), so elements are still
    // built through DOM APIs.  The gate is what makes "installed" mean
    // "observable by the next `evaluate`" -- see `installDocument` (#888).
    //
    // The hook declares its own budget, as the three sibling suites do.  It
    // used to wrap each step in a `withTimeout` race instead, which could
    // never fire: the races were armed at 15 s inside a hook running on
    // vitest's undeclared 10 s default, so the runner's own abort always won
    // and the labelled message was unreachable.  Declaring the budget is what
    // the label was reaching for, and `installDocument` carries its own budget,
    // whose failure names the sentinel that never matched.
    await installDocument(client, EMPTY_DOCUMENT_HTML);
  }, INSTALL_TEST_TIMEOUT_MS);

  afterEach(() => {
    client.disconnect();
  });

  // ── waitForElement ──────────────────────────────────────────────

  describe("waitForElement", () => {
    it("should resolve immediately when element already exists", async () => {
      await client.evaluate(`(() => {
        const el = document.createElement('div');
        el.id = 'existing';
        el.textContent = 'Hello';
        document.body.appendChild(el);
      })()`);

      await waitForElement(client, "#existing", { timeout: 2000 });
    });

    it("should resolve when element appears after a delay", { timeout: 15_000 }, async () => {
      await client.evaluate(`
        setTimeout(() => {
          const el = document.createElement('div');
          el.id = 'delayed';
          document.body.appendChild(el);
        }, 200);
      `);

      await waitForElement(client, "#delayed", { timeout: 5000 });
    });

    it("should reject with CDPTimeoutError when element never appears", async () => {
      await expect(
        waitForElement(client, "#nonexistent", { timeout: 500 }),
      ).rejects.toThrow(CDPTimeoutError);
    });
  });

  // ── click ───────────────────────────────────────────────────────

  describe("click", () => {
    it("should click the element via JS .click()", async () => {
      await client.evaluate(`(() => {
        const btn = document.createElement('button');
        btn.id = 'btn';
        btn.textContent = 'Click me';
        document.body.appendChild(btn);
        window.__clicked = false;
        btn.addEventListener('click', () => { window.__clicked = true; });
      })()`);

      await click(client, "#btn");

      const clicked = await client.evaluate<boolean>("window.__clicked");
      expect(clicked).toBe(true);
    });

    it("should throw CDPEvaluationError when element not found", async () => {
      await expect(click(client, "#missing")).rejects.toThrow(
        CDPEvaluationError,
      );
    });
  });

  // ── scrollTo ────────────────────────────────────────────────────

  describe("scrollTo", () => {
    it("should scroll the element into view", async () => {
      await client.evaluate(`(() => {
        document.body.style.margin = '0';
        document.body.style.height = '3000px';
        const el = document.createElement('div');
        el.id = 'bottom';
        el.textContent = 'Bottom';
        el.style.position = 'absolute';
        el.style.top = '2500px';
        document.body.appendChild(el);
      })()`);

      // Verify element is initially below the viewport
      const beforeY = await client.evaluate<number>(
        `document.getElementById('bottom').getBoundingClientRect().top`,
      );
      expect(beforeY).toBeGreaterThan(600);

      await scrollTo(client, "#bottom");

      // Verify element is now within the viewport
      const afterRect = await client.evaluate<{ top: number; bottom: number }>(
        `(() => {
          const r = document.getElementById('bottom').getBoundingClientRect();
          return { top: r.top, bottom: r.bottom };
        })()`,
      );
      const viewportHeight = await client.evaluate<number>(
        "window.innerHeight",
      );
      expect(afterRect.top).toBeGreaterThanOrEqual(0);
      expect(afterRect.top).toBeLessThan(viewportHeight);
    });

    it("should throw CDPEvaluationError when element not found", async () => {
      await expect(scrollTo(client, "#missing")).rejects.toThrow(
        CDPEvaluationError,
      );
    });
  });

  // ── typeText ────────────────────────────────────────────────────

  describe("typeText", () => {
    it("should type characters one-by-one into an input", async () => {
      await client.evaluate(`(() => {
        const input = document.createElement('input');
        input.id = 'input';
        input.type = 'text';
        document.body.appendChild(input);
        window.__inputEvents = 0;
        input.addEventListener('keydown', () => { window.__inputEvents++; });
      })()`);

      await typeText(client, "#input", "hello");

      const value = await client.evaluate<string>(
        `document.getElementById('input').value`,
      );
      expect(value).toBe("hello");

      // Each character should have triggered a keydown event
      const eventCount = await client.evaluate<number>(
        "window.__inputEvents",
      );
      expect(eventCount).toBe(5);
    });

    it("should type into a contenteditable element", async () => {
      await client.evaluate(`(() => {
        const editor = document.createElement('div');
        editor.id = 'editor';
        editor.contentEditable = 'true';
        document.body.appendChild(editor);
      })()`);

      await typeText(client, "#editor", "abc");

      const text = await client.evaluate<string>(
        `document.getElementById('editor').textContent`,
      );
      expect(text).toBe("abc");
    });

    it("should throw CDPEvaluationError when element not found", async () => {
      await expect(
        typeText(client, "#missing", "text"),
      ).rejects.toThrow(CDPEvaluationError);
    });
  });
});
