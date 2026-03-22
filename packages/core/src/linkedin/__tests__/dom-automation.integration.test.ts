// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CDPClient } from "../../cdp/client.js";
import { CDPEvaluationError, CDPTimeoutError } from "../../cdp/errors.js";
import {
  launchChromium,
  type ChromiumInstance,
} from "../../cdp/testing/launch-chromium.js";
import { click, scrollTo, typeText, waitForElement } from "../dom-automation.js";

/** Timeout for beforeEach operations (connect + reset) on slow CI runners. */
const BEFORE_EACH_TIMEOUT = 15_000;

/**
 * Race a promise against a timeout, throwing a descriptive error on expiry.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const ac = new AbortController();
  const timeout = new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    ac.signal.addEventListener("abort", () => clearTimeout(timer));
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    ac.abort();
  }
}

/**
 * Helper to clear document body and create elements without innerHTML
 * (which is blocked by Chromium's Trusted Types policy).
 */
async function resetBody(client: CDPClient): Promise<void> {
  await client.evaluate(
    `while (document.body.firstChild) document.body.removeChild(document.body.firstChild)`,
  );
}

describe("DOM automation (integration)", () => {
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
    await withTimeout(client.connect(), BEFORE_EACH_TIMEOUT, "client.connect()");
    await withTimeout(resetBody(client), BEFORE_EACH_TIMEOUT, "resetBody()");
  });

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
