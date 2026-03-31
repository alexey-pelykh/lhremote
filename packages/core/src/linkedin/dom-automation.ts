// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { CDPClient } from "../cdp/client.js";
import { CDPEvaluationError, CDPTimeoutError } from "../cdp/errors.js";
import { delay, gaussianBetween, gaussianDelay, randomBetween } from "../utils/delay.js";
import type { HumanizedMouse } from "./humanized-mouse.js";

/** Default timeout for DOM operations (ms). */
const DEFAULT_TIMEOUT = 30_000;

/** Default polling interval for waitForElement (ms). */
const DEFAULT_POLL_INTERVAL = 100;

/** Probability of a micro-hesitation between keystrokes. */
const MICRO_HESITATION_PROBABILITY = 0.05;

/** Physical key code info for a character, used to enrich CDP key events. */
interface KeyCodeInfo {
  code: string;
  windowsVirtualKeyCode: number;
}

/**
 * Map a character to its physical key code and Windows virtual key code.
 *
 * Covers ASCII letters, digits, common punctuation, and special keys
 * (space, enter, tab, backspace, escape).  Returns `undefined` for
 * unmapped characters — the event still fires, just without enrichment.
 */
function getKeyCodeInfo(char: string): KeyCodeInfo | undefined {
  // Letters a-z / A-Z
  const lower = char.toLowerCase();
  if (lower >= "a" && lower <= "z") {
    const vk = 65 + lower.charCodeAt(0) - "a".charCodeAt(0);
    return { code: `Key${lower.toUpperCase()}`, windowsVirtualKeyCode: vk };
  }

  // Digits 0-9
  if (char >= "0" && char <= "9") {
    const vk = 48 + char.charCodeAt(0) - "0".charCodeAt(0);
    return { code: `Digit${char}`, windowsVirtualKeyCode: vk };
  }

  // Special keys and punctuation
  const special: Record<string, KeyCodeInfo> = {
    " ": { code: "Space", windowsVirtualKeyCode: 32 },
    "\n": { code: "Enter", windowsVirtualKeyCode: 13 },
    "\r": { code: "Enter", windowsVirtualKeyCode: 13 },
    "\t": { code: "Tab", windowsVirtualKeyCode: 9 },
    "-": { code: "Minus", windowsVirtualKeyCode: 189 },
    "=": { code: "Equal", windowsVirtualKeyCode: 187 },
    "[": { code: "BracketLeft", windowsVirtualKeyCode: 219 },
    "]": { code: "BracketRight", windowsVirtualKeyCode: 221 },
    "\\": { code: "Backslash", windowsVirtualKeyCode: 220 },
    ";": { code: "Semicolon", windowsVirtualKeyCode: 186 },
    "'": { code: "Quote", windowsVirtualKeyCode: 222 },
    ",": { code: "Comma", windowsVirtualKeyCode: 188 },
    ".": { code: "Period", windowsVirtualKeyCode: 190 },
    "/": { code: "Slash", windowsVirtualKeyCode: 191 },
    "`": { code: "Backquote", windowsVirtualKeyCode: 192 },
  };

  return special[char];
}

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
 * When a {@link HumanizedMouse} is provided, tiny idle mouse movements
 * (1–5 px) are dispatched on ~20% of poll cycles once the wait exceeds
 * 500 ms.  This prevents the cursor from remaining perfectly still
 * during long element waits — a detectable automation fingerprint.
 *
 * @param client   - Connected CDP client targeting the page.
 * @param selector - CSS selector to query.
 * @param options  - Timeout and polling interval.
 * @param mouse    - Optional humanized mouse (enables idle drift).
 * @throws {CDPTimeoutError} If the element does not appear within the timeout.
 */
export async function waitForElement(
  client: CDPClient,
  selector: string,
  options?: WaitForElementOptions,
  mouse?: HumanizedMouse | null,
): Promise<void> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const pollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL;
  const deadline = Date.now() + timeout;
  const startTime = Date.now();

  // Last known cursor position for idle drift (lazy-initialised)
  let driftX = -1;
  let driftY = -1;

  while (Date.now() < deadline) {
    const found = await client.evaluate<boolean>(
      `document.querySelector(${JSON.stringify(selector)}) !== null`,
    );
    if (found) return;

    // Idle mouse drift: after 500 ms of waiting, 20% of poll cycles
    // dispatch a tiny mouseMoved event to avoid a perfectly still cursor.
    if (mouse?.isAvailable && Date.now() - startTime > 500 && Math.random() < 0.2) {
      if (driftX < 0) {
        try {
          const pos = await mouse.position();
          driftX = pos.x;
          driftY = pos.y;
        } catch {
          // Default to viewport center when position is unavailable
          const vh = await getViewportHeight(client);
          driftX = 400;
          driftY = Math.round(vh / 2);
        }
      }
      const offsetX = Math.round(randomBetween(-5, 5));
      const offsetY = Math.round(randomBetween(-5, 5));
      driftX += offsetX;
      driftY += offsetY;
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: driftX,
        y: driftY,
      });
    }

    await delay(pollInterval);
  }

  throw new CDPTimeoutError(
    `Timed out waiting for element "${selector}" after ${timeout.toString()}ms`,
  );
}

/**
 * Wait until the DOM stops mutating for `quietMs` milliseconds.
 *
 * Installs a `MutationObserver` via `Runtime.evaluate` that tracks
 * the timestamp of the last mutation.  Polls until no mutations have
 * occurred for the configured quiet period, then adds a "visual
 * scanning" Gaussian delay to simulate a human pausing to read.
 *
 * @param client  - Connected CDP client targeting the page.
 * @param quietMs - Milliseconds of mutation silence required (default: 500).
 */
export async function waitForDOMStable(
  client: CDPClient,
  quietMs = 500,
): Promise<void> {
  // Install a MutationObserver that stamps window.__lhLastMutation on every DOM change
  await client.evaluate(
    `(() => {
      window.__lhLastMutation = Date.now();
      const observer = new MutationObserver(() => {
        window.__lhLastMutation = Date.now();
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      window.__lhDOMObserver = observer;
    })()`,
  );

  // Poll until the DOM has been quiet for quietMs
  const pollInterval = 100;
  const maxWait = 30_000;
  const deadline = Date.now() + maxWait;

  while (Date.now() < deadline) {
    const elapsed = await client.evaluate<number>(
      `Date.now() - (window.__lhLastMutation || 0)`,
    );
    if (elapsed >= quietMs) break;
    await delay(pollInterval);
  }

  // Disconnect the observer
  await client.evaluate(
    `(() => {
      if (window.__lhDOMObserver) {
        window.__lhDOMObserver.disconnect();
        delete window.__lhDOMObserver;
        delete window.__lhLastMutation;
      }
    })()`,
  );

  // Simulate "visual scanning" — a human pausing to read the page
  await gaussianDelay(1_200, 400, 600, 2_500);
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
 * Trigger a hover on an element by dispatching `mouseenter` + `mouseover`.
 *
 * This is used to reveal hover-dependent UI such as the LinkedIn
 * reactions menu popup.
 *
 * @param client   - Connected CDP client targeting the page.
 * @param selector - CSS selector for the element to hover.
 * @throws {CDPEvaluationError} If the element is not found.
 */
export async function hover(
  client: CDPClient,
  selector: string,
): Promise<void> {
  const hovered = await client.evaluate<boolean>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.x + r.width / 2);
      const cy = Math.round(r.y + r.height / 2);
      const opts = {
        bubbles: true, clientX: cx, clientY: cy,
        screenX: cx + window.screenX, screenY: cy + window.screenY,
        button: 0, buttons: 0,
      };
      el.dispatchEvent(new MouseEvent('mouseenter', opts));
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      return true;
    })()`,
  );

  if (!hovered) {
    throw new CDPEvaluationError(
      `Element "${selector}" not found for hover`,
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
 * CDP `Input.dispatchKeyEvent` with character-context-aware Gaussian
 * delays to approximate human typing cadence:
 *
 * - **Intra-word** (letters, digits): ~65 ms mean — fast, rhythmic typing
 * - **Word boundary** (space): ~180 ms mean — natural pause between words
 * - **Sentence boundary** (space after `.!?`): ~350 ms mean — thinking pause
 * - **Paragraph boundary** (newline): ~700 ms mean — composing the next thought
 * - **Micro-hesitation** (5% per character): ~300 ms extra — brief mid-word thinking
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
    case "type": {
      let previousChar = "";
      for (const char of text) {
        const kc = getKeyCodeInfo(char);
        await client.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: char,
          text: char,
          ...(kc && { code: kc.code, windowsVirtualKeyCode: kc.windowsVirtualKeyCode }),
        });
        await client.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: char,
          ...(kc && { code: kc.code, windowsVirtualKeyCode: kc.windowsVirtualKeyCode }),
        });

        // Character-aware delay
        if (char === "\n") {
          await gaussianDelay(700, 300, 300, 1_500);
        } else if (char === " " && /[.!?]/.test(previousChar)) {
          await gaussianDelay(350, 120, 150, 800);
        } else if (char === " ") {
          await gaussianDelay(180, 50, 100, 350);
        } else {
          await gaussianDelay(65, 20, 30, 120);
        }

        // Micro-hesitation (5%)
        if (Math.random() < MICRO_HESITATION_PROBABILITY) {
          await gaussianDelay(300, 100, 150, 600);
        }

        previousChar = char;
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Element geometry helpers
// ---------------------------------------------------------------------------

/** Bounding rect returned by element bounds queries. */
export interface ElementBounds {
  top: number;
  bottom: number;
  height: number;
}

/**
 * Get the bounding rect of a DOM element selected by CSS selector.
 *
 * @returns `null` if the element is not found.
 */
export async function getElementBounds(
  client: CDPClient,
  selector: string,
): Promise<ElementBounds | null> {
  return client.evaluate<ElementBounds | null>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    })()`,
  );
}

/**
 * Get the bounding rect of the Nth element matching a CSS selector.
 *
 * Equivalent to `document.querySelectorAll(baseSelector)[index]`.
 *
 * @returns `null` if no element exists at the given index.
 */
export async function getElementBoundsByIndex(
  client: CDPClient,
  baseSelector: string,
  index: number,
): Promise<ElementBounds | null> {
  return client.evaluate<ElementBounds | null>(
    `(() => {
      const els = document.querySelectorAll(${JSON.stringify(baseSelector)});
      const el = els[${String(index)}];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    })()`,
  );
}

/**
 * Get the viewport height (`window.innerHeight`).
 */
export async function getViewportHeight(
  client: CDPClient,
): Promise<number> {
  return client.evaluate<number>(`window.innerHeight`);
}

// ---------------------------------------------------------------------------
// Humanized scroll-to-element
// ---------------------------------------------------------------------------

/**
 * Internal: incremental scroll loop that centers an element in the viewport.
 *
 * @returns `true` if the element was centered within `maxIterations`.
 */
async function scrollToElementLoop(
  client: CDPClient,
  getBounds: () => Promise<ElementBounds | null>,
  mouse: HumanizedMouse,
): Promise<boolean> {
  const viewportHeight = await getViewportHeight(client);
  const maxIterations = 10;
  const tolerance = viewportHeight / 4;

  for (let i = 0; i < maxIterations; i++) {
    const bounds = await getBounds();
    if (!bounds) return false;

    const elementCenter = bounds.top + bounds.height / 2;
    const viewportCenter = viewportHeight / 2;

    if (Math.abs(elementCenter - viewportCenter) <= tolerance) {
      return true;
    }

    const deltaY = elementCenter - viewportCenter;
    await humanizedScrollY(client, deltaY, 300, 400, mouse);
    await gaussianDelay(300, 50, 200, 400);
  }

  return false;
}

/**
 * Scroll the page until the target element is centered in the viewport,
 * using incremental humanized mouse-wheel strokes.
 *
 * When a {@link HumanizedMouse} is available, the cursor scrolls the page
 * in small increments until the element's bounding rect is in the viewport
 * center zone.  Falls back to instant `scrollIntoView` otherwise.
 *
 * @param client   - Connected CDP client targeting the page.
 * @param selector - CSS selector for the element to scroll to.
 * @param mouse    - Optional humanized mouse instance.
 */
export async function humanizedScrollTo(
  client: CDPClient,
  selector: string,
  mouse?: HumanizedMouse | null,
): Promise<void> {
  if (mouse?.isAvailable) {
    const success = await scrollToElementLoop(
      client,
      () => getElementBounds(client, selector),
      mouse,
    );
    if (success) return;
  }
  await scrollTo(client, selector);
}

/**
 * Scroll the page until the Nth element matching a selector is centered,
 * using incremental humanized mouse-wheel strokes.
 *
 * Falls back to instant `scrollIntoView` when humanized mouse is unavailable.
 *
 * @param client       - Connected CDP client targeting the page.
 * @param baseSelector - CSS selector matching multiple elements.
 * @param index        - Zero-based index into the matched elements.
 * @param mouse        - Optional humanized mouse instance.
 */
export async function humanizedScrollToByIndex(
  client: CDPClient,
  baseSelector: string,
  index: number,
  mouse?: HumanizedMouse | null,
): Promise<void> {
  if (mouse?.isAvailable) {
    const success = await scrollToElementLoop(
      client,
      () => getElementBoundsByIndex(client, baseSelector, index),
      mouse,
    );
    if (success) return;
  }
  // Fallback to instant scrollIntoView
  await client.evaluate(
    `(() => {
      const els = document.querySelectorAll(${JSON.stringify(baseSelector)});
      const el = els[${String(index)}];
      if (el) el.scrollIntoView({ behavior: "instant", block: "center" });
    })()`,
  );
}

// ---------------------------------------------------------------------------
// Humanized interaction helpers
// ---------------------------------------------------------------------------

/** Bounding rect returned by the element center helper. */
interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Viewport-relative point returned by `getElementCenter`. */
interface ElementCenter {
  x: number;
  y: number;
}

/**
 * Get a jittered viewport-relative point near the center of a DOM element.
 *
 * A Gaussian offset is applied so the click target varies naturally within
 * the element bounds, removing the dead-center automation fingerprint.
 *
 * @returns `null` if the element is not found.
 */
export async function getElementCenter(
  client: CDPClient,
  selector: string,
): Promise<ElementCenter | null> {
  const rect = await client.evaluate<ElementRect | null>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`,
  );
  if (!rect) return null;

  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;

  const jx = cx + gaussianBetween(0, rect.width * 0.15, -rect.width * 0.4, rect.width * 0.4);
  const jy = cy + gaussianBetween(0, rect.height * 0.15, -rect.height * 0.4, rect.height * 0.4);

  const roundedJx = Math.round(jx);
  const roundedJy = Math.round(jy);
  const maxX = rect.width >= 1 ? rect.x + rect.width - 1 : rect.x;
  const maxY = rect.height >= 1 ? rect.y + rect.height - 1 : rect.y;

  return {
    x: Math.max(rect.x, Math.min(maxX, roundedJx)),
    y: Math.max(rect.y, Math.min(maxY, roundedJy)),
  };
}

/**
 * Scroll the element toward the viewport center if it sits in the outer
 * 20% of the visible area.  This mimics a human scrolling a bit to see
 * the target more comfortably before clicking.
 *
 * @internal
 */
async function viewportComfortZone(
  client: CDPClient,
  selector: string,
  mouse?: HumanizedMouse | null,
): Promise<void> {
  const viewportHeight = await getViewportHeight(client);
  const center = await getElementCenter(client, selector);
  if (!center) return;

  if (center.y < viewportHeight * 0.2 || center.y > viewportHeight * 0.8) {
    const deltaY = center.y - viewportHeight / 2;
    await humanizedScrollY(client, deltaY * 0.5, center.x, center.y, mouse);
    await gaussianDelay(300, 100, 150, 600);
  }
}

/**
 * Click an element with humanized mouse movement when available.
 *
 * When a {@link HumanizedMouse} is provided and available, the cursor
 * follows a Bezier path to the element center before clicking.  The
 * VirtualMouse dispatches `mousePressed` / `mouseReleased` via CDP.
 *
 * **Pre-focus hover** (60% probability, HumanizedMouse only): before
 * clicking, the cursor first moves to a point 20–50 px from the target,
 * pauses briefly to simulate visual scanning, then proceeds to the
 * target — a two-phase approach that mimics how a human visually locates
 * a button before moving to click it.
 *
 * **Viewport comfort zone**: if the target sits in the outer 20% of the
 * viewport, a small scroll brings it more central before interacting.
 *
 * Falls back to the standard JS `.click()` when humanized mouse is
 * unavailable (or the element cannot be located by bounding rect).
 *
 * @param client - Connected CDP client targeting the LinkedIn page.
 * @param selector - CSS selector for the element to click.
 * @param mouse  - Optional humanized mouse instance.
 */
export async function humanizedClick(
  client: CDPClient,
  selector: string,
  mouse?: HumanizedMouse | null,
): Promise<void> {
  // Viewport comfort zone: scroll element toward center if near edges
  await viewportComfortZone(client, selector, mouse);

  await gaussianDelay(25, 12, 0, 50); // Pre-click approach hesitation
  if (mouse?.isAvailable) {
    const center = await getElementCenter(client, selector);
    if (center) {
      // Pre-focus hover: 60% of the time, approach via a nearby point first
      if (Math.random() < 0.6) {
        const angle = Math.random() * 2 * Math.PI;
        const radius = randomBetween(20, 50);
        const nearX = Math.round(center.x + Math.cos(angle) * radius);
        const nearY = Math.round(center.y + Math.sin(angle) * radius);
        await mouse.move(nearX, nearY);
        await gaussianDelay(180, 60, 80, 400); // Visual scanning pause
      }

      await mouse.click(center.x, center.y);
      await gaussianDelay(100, 25, 50, 150); // Post-click visual confirmation
      return;
    }
  }
  // Fallback: simulate mouse movement path before JS click
  const center = await getElementCenter(client, selector);
  if (center) {
    const viewportSize = await client.evaluate<{ w: number; h: number }>(
      `({ w: window.innerWidth, h: window.innerHeight })`,
    );
    // Random starting position within the viewport
    const startX = Math.round(Math.random() * viewportSize.w);
    const startY = Math.round(Math.random() * viewportSize.h);
    const steps = Math.round(gaussianBetween(4, 0.7, 3, 5));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const baseX = startX + (center.x - startX) * t;
      const baseY = startY + (center.y - startY) * t;
      // Add random offset to intermediate points, not the final point
      const offsetX = i < steps ? Math.round(gaussianBetween(0, 10, -20, 20)) : 0;
      const offsetY = i < steps ? Math.round(gaussianBetween(0, 10, -20, 20)) : 0;
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: Math.round(baseX) + offsetX,
        y: Math.round(baseY) + offsetY,
      });
      await gaussianDelay(25, 10, 10, 50);
    }
  }

  await click(client, selector);
  await gaussianDelay(100, 25, 50, 150); // Post-click visual confirmation
}

/**
 * Hover over an element with humanized mouse movement when available.
 *
 * When a {@link HumanizedMouse} is provided, the cursor physically
 * moves to the element center — which is more realistic than
 * dispatching synthetic `mouseenter` / `mouseover` JS events.
 *
 * Falls back to synthetic JS events when unavailable.
 *
 * @param client - Connected CDP client targeting the LinkedIn page.
 * @param selector - CSS selector for the element to hover.
 * @param mouse  - Optional humanized mouse instance.
 */
export async function humanizedHover(
  client: CDPClient,
  selector: string,
  mouse?: HumanizedMouse | null,
): Promise<void> {
  await gaussianDelay(25, 12, 0, 50); // Pre-hover approach hesitation
  if (mouse?.isAvailable) {
    const center = await getElementCenter(client, selector);
    if (center) {
      await mouse.move(center.x, center.y);
      return;
    }
  }
  // Fallback to JS hover
  await hover(client, selector);
}

/**
 * Scroll the page vertically with humanized mouse-wheel strokes.
 *
 * When a {@link HumanizedMouse} is provided, scrolling is emulated as
 * incremental wheel strokes (150 px / 25 ms) at the given position,
 * matching the behavior of a physical mouse wheel.
 *
 * Falls back to a single CDP `mouseWheel` event when unavailable.
 *
 * @param client - Connected CDP client targeting the LinkedIn page.
 * @param deltaY - Pixels to scroll (positive = down).
 * @param x      - Viewport X coordinate for the scroll position.
 * @param y      - Viewport Y coordinate for the scroll position.
 * @param mouse  - Optional humanized mouse instance.
 */
export async function humanizedScrollY(
  client: CDPClient,
  deltaY: number,
  x: number,
  y: number,
  mouse?: HumanizedMouse | null,
): Promise<void> {
  if (mouse?.isAvailable) {
    await mouse.scrollY(deltaY, x, y);
    return;
  }
  // Fallback to a single CDP scroll event
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX: 0,
    deltaY,
  });
}

/**
 * Retry an interaction function with escalating Gaussian-distributed
 * delays between attempts.
 *
 * Wraps critical interaction sequences (click after scroll, hover after
 * navigate) where elements may vanish due to React re-renders.  Each
 * retry waits progressively longer — `800 * (attempt + 1)` ms mean —
 * giving the page time to stabilise.
 *
 * @param fn          - The async interaction to attempt.
 * @param maxAttempts - Maximum number of attempts (default: 2).
 * @returns The result of the first successful attempt.
 */
export async function retryInteraction<T>(
  fn: () => Promise<T>,
  maxAttempts = 2,
): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === maxAttempts - 1) throw e;
      await gaussianDelay(800 * (i + 1), 300, 400, 2_000);
    }
  }
  // Unreachable — the loop always returns or throws
  throw new Error("unreachable");
}
