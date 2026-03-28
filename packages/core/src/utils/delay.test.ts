// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";
import { delay, randomBetween, maybeHesitate } from "./delay.js";

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
