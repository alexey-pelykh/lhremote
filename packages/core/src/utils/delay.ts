// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Return a promise that resolves after the given number of milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Return a promise that resolves after a random delay between `min` and `max` milliseconds.
 *
 * This mimics human timing variations such as thinking pauses and
 * visual scanning between UI interactions.
 */
export function randomDelay(min: number, max: number): Promise<void> {
  return delay(min + Math.random() * (max - min));
}

/**
 * Return a random number between `min` and `max` (inclusive of min, exclusive of max).
 *
 * Useful for randomising scroll distances, coordinate offsets, and other
 * non-delay numeric values that benefit from human-like variation.
 */
export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * With the given probability (default 12%), insert a random pause of 500–2000 ms.
 *
 * Simulates the irregular micro-pauses humans exhibit: hovering briefly,
 * momentarily slowing, or pausing before deciding to act.  Breaks
 * statistical uniformity in timing patterns without adding significant
 * average time.
 */
export function maybeHesitate(probability = 0.12): Promise<void> {
  if (Math.random() < probability) {
    return randomDelay(500, 2_000);
  }
  return Promise.resolve();
}
