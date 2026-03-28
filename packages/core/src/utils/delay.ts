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
