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
    return gaussianDelay(1_250, 375, 500, 2_000);
  }
  return Promise.resolve();
}

/**
 * With the given probability (default 4%), insert a longer pause of 2–12 s.
 *
 * Simulates the natural micro-breaks humans take during extended browsing
 * sessions: checking another tab, reading a notification, sipping coffee.
 * Intended for use inside long scroll or extraction loops to break up
 * otherwise rhythmic interaction patterns.
 */
export function maybeBreak(probability = 0.04): Promise<void> {
  if (Math.random() < probability) {
    return gaussianDelay(5_000, 2_000, 2_000, 12_000);
  }
  return Promise.resolve();
}

/**
 * Return a normally-distributed random number using the Box-Muller transform.
 *
 * The result is centered on `mean` with the given `stdDev`.  Unlike
 * uniform `Math.random()`, this produces a bell-curve distribution
 * that more closely models human timing variance.
 */
export function gaussianRandom(mean: number, stdDev: number): number {
  // Box-Muller transform: two uniform samples → one normal sample
  let u1: number;
  let u2: number;
  do {
    u1 = Math.random();
    u2 = Math.random();
  } while (u1 === 0); // avoid log(0)

  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z * stdDev;
}

/**
 * Return a promise that resolves after a Gaussian-distributed delay.
 *
 * The delay is drawn from a normal distribution centered on `mean` with
 * the given `stdDev`, then clamped to `[min, max]`.  This produces more
 * human-like timing than uniform random — most delays cluster near the
 * mean with occasional faster or slower outliers.
 *
 * @param mean   - Center of the distribution in milliseconds.
 * @param stdDev - Standard deviation in milliseconds.
 * @param min    - Minimum delay in milliseconds (default: 0).
 * @param max    - Maximum delay in milliseconds (default: Infinity).
 */
export function gaussianDelay(
  mean: number,
  stdDev: number,
  min = 0,
  max = Infinity,
): Promise<void> {
  const raw = gaussianRandom(mean, stdDev);
  const clamped = Math.max(min, Math.min(max, raw));
  return delay(clamped);
}

/**
 * Return a Gaussian-distributed numeric value clamped to `[min, max]`.
 *
 * Useful for randomising scroll distances, coordinate offsets, and other
 * non-delay numeric values that benefit from human-like variation.
 *
 * @param mean   - Center of the distribution.
 * @param stdDev - Standard deviation.
 * @param min    - Minimum value.
 * @param max    - Maximum value.
 */
export function gaussianBetween(
  mean: number,
  stdDev: number,
  min: number,
  max: number,
): number {
  const raw = gaussianRandom(mean, stdDev);
  return Math.max(min, Math.min(max, raw));
}
