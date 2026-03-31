// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";
import {
  delay,
  randomBetween,
  maybeHesitate,
  gaussianRandom,
  gaussianBetween,
} from "./delay.js";

describe("delay", () => {
  it("should resolve after the given time", async () => {
    const start = Date.now();
    await delay(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("should return a promise that resolves to undefined", async () => {
    const result = await delay(0);
    expect(result).toBeUndefined();
  });
});

describe("randomBetween", () => {
  it("returns a value within the specified range", () => {
    for (let i = 0; i < 100; i++) {
      const value = randomBetween(10, 20);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThan(20);
    }
  });

  it("returns min when range is zero", () => {
    expect(randomBetween(5, 5)).toBe(5);
  });
});

describe("gaussianRandom", () => {
  it("produces values with approximately correct mean and stdDev over many samples", () => {
    const mean = 100;
    const stdDev = 25;
    const n = 10_000;
    const samples: number[] = [];

    for (let i = 0; i < n; i++) {
      samples.push(gaussianRandom(mean, stdDev));
    }

    const sampleMean = samples.reduce((a, b) => a + b, 0) / n;
    const sampleVariance =
      samples.reduce((sum, x) => sum + (x - sampleMean) ** 2, 0) / (n - 1);
    const sampleStdDev = Math.sqrt(sampleVariance);

    // Allow ±5% tolerance on mean and ±10% on stdDev
    expect(sampleMean).toBeGreaterThan(mean * 0.95);
    expect(sampleMean).toBeLessThan(mean * 1.05);
    expect(sampleStdDev).toBeGreaterThan(stdDev * 0.9);
    expect(sampleStdDev).toBeLessThan(stdDev * 1.1);
  });

  it("centers on the given mean when stdDev is 0", () => {
    for (let i = 0; i < 100; i++) {
      expect(gaussianRandom(42, 0)).toBe(42);
    }
  });
});

describe("gaussianBetween", () => {
  it("always returns values within [min, max]", () => {
    for (let i = 0; i < 1_000; i++) {
      const value = gaussianBetween(500, 100, 300, 700);
      expect(value).toBeGreaterThanOrEqual(300);
      expect(value).toBeLessThanOrEqual(700);
    }
  });

  it("returns min when range is zero", () => {
    expect(gaussianBetween(5, 0, 5, 5)).toBe(5);
  });

  it("clamps values that would exceed bounds", () => {
    // With a very large stdDev, values should still be clamped
    for (let i = 0; i < 100; i++) {
      const value = gaussianBetween(50, 1_000, 0, 100);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe("maybeHesitate", () => {
  it("resolves to undefined", async () => {
    const result = await maybeHesitate(0);
    expect(result).toBeUndefined();
  });

  it("never pauses with probability 0", async () => {
    const start = Date.now();
    await maybeHesitate(0);
    expect(Date.now() - start).toBeLessThan(50);
  });
});
