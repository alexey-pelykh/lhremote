// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { CDPClient } from "../cdp/client.js";
import { CDPEvaluationError, CDPTimeoutError } from "../cdp/errors.js";
import { delay } from "../utils/delay.js";

/** Default timeout for DOM operations (ms). */
const DEFAULT_TIMEOUT = 30_000;

/** Default polling interval for waitForElement (ms). */
const DEFAULT_POLL_INTERVAL = 100;

/** Minimum delay between keystrokes (ms). */
const MIN_KEYSTROKE_DELAY = 50;

/** Maximum delay between keystrokes (ms). */
const MAX_KEYSTROKE_DELAY = 150;

/** Options for {@link waitForElement}. */
export interface WaitForElementOptions {
  /** Maximum time to wait in ms (default: 30 000). */
  timeout?: number;
  /** Polling interval in ms (default: 100). */
  pollInterval?: number;
}

/** Text input method for {@link typeText}. */
export type TypeMethod = "type";

/**
 * Poll the DOM until an element matching the selector appears.
 *
 * @param client   - Connected CDP client targeting the page.
 * @param selector - CSS selector to query.
 * @param options  - Timeout and polling interval.
 * @throws {CDPTimeoutError} If the element does not appear within the timeout.
 */
export async function waitForElement(
  client: CDPClient,
  selector: string,
  options?: WaitForElementOptions,
): Promise<void> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const pollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const found = await client.evaluate<boolean>(
      `document.querySelector(${JSON.stringify(selector)}) !== null`,
    );
    if (found) return;
    await delay(pollInterval);
  }

  throw new CDPTimeoutError(
    `Timed out waiting for element "${selector}" after ${timeout.toString()}ms`,
  );
}

/**
 * Scroll the page until the target element is visible in the viewport.
 *
 * The element must already exist in the DOM.  Use {@link waitForElement}
 * first if it may not be present yet.
 *
 * @param client   - Connected CDP client targeting the page.
 * @param selector - CSS selector for the element to scroll to.
 * @throws {CDPEvaluationError} If the element is not found.
 */
export async function scrollTo(
  client: CDPClient,
  selector: string,
): Promise<void> {
  const scrolled = await client.evaluate<boolean>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ behavior: "instant", block: "center" });
      return true;
    })()`,
  );

  if (!scrolled) {
    throw new CDPEvaluationError(
      `Element "${selector}" not found for scrollTo`,
    );
  }
}

/**
 * Click an element via its JavaScript `.click()` method.
 *
 * Uses JS `.click()` rather than `Input.dispatchMouseEvent` because the
 * latter does not reliably trigger handlers on LinkedIn's React components.
 *
 * @param client   - Connected CDP client targeting the page.
 * @param selector - CSS selector for the element to click.
 * @throws {CDPEvaluationError} If the element is not found.
 */
export async function click(
  client: CDPClient,
  selector: string,
): Promise<void> {
  const clicked = await client.evaluate<boolean>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`,
  );

  if (!clicked) {
    throw new CDPEvaluationError(
      `Element "${selector}" not found for click`,
    );
  }
}

/**
 * Type text into a focused element character-by-character.
 *
 * The element is focused first, then each character is dispatched via
 * CDP `Input.dispatchKeyEvent` with randomised inter-keystroke delays
 * (50–150 ms) to approximate human typing cadence.
 *
 * @param client   - Connected CDP client targeting the page.
 * @param selector - CSS selector for the input element.
 * @param text     - The string to type.
 * @param method   - Input method (default: `"type"`).
 * @throws {CDPEvaluationError} If the element is not found.
 */
export async function typeText(
  client: CDPClient,
  selector: string,
  text: string,
  method: TypeMethod = "type",
): Promise<void> {
  const focused = await client.evaluate<boolean>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      return true;
    })()`,
  );

  if (!focused) {
    throw new CDPEvaluationError(
      `Element "${selector}" not found for typeText`,
    );
  }

  switch (method) {
    case "type":
      for (const char of text) {
        await client.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: char,
          text: char,
        });
        await client.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: char,
        });

        const keystrokeDelay =
          MIN_KEYSTROKE_DELAY +
          Math.random() * (MAX_KEYSTROKE_DELAY - MIN_KEYSTROKE_DELAY);
        await delay(keystrokeDelay);
      }
      break;
  }
}
