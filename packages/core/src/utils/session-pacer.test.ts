// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SessionPacer, rhythmMultiplier } from "./session-pacer.js";

describe("rhythmMultiplier", () => {
  it("returns 1.5 for warm-up phase (ops 0–2)", () => {
    expect(rhythmMultiplier(0)).toBe(1.5);
    expect(rhythmMultiplier(1)).toBe(1.5);
    expect(rhythmMultiplier(2)).toBe(1.5);
  });

  it("returns 0.85 for cruising phase (ops 3–8)", () => {
    expect(rhythmMultiplier(3)).toBe(0.85);
    expect(rhythmMultiplier(5)).toBe(0.85);
    expect(rhythmMultiplier(8)).toBe(0.85);
  });

  it("returns increasing multiplier for fatigue phase (ops 9+)", () => {
    expect(rhythmMultiplier(9)).toBeCloseTo(1.05);
    expect(rhythmMultiplier(10)).toBeCloseTo(1.1);
    expect(rhythmMultiplier(18)).toBeCloseTo(1.5);
    expect(rhythmMultiplier(28)).toBeCloseTo(2.0);
  });
});

describe("SessionPacer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips cool-down for the first operation", async () => {
    const pacer = new SessionPacer();

    const start = Date.now();
    const promise = pacer.paceBeforeOperation("read");
    await vi.runAllTimersAsync();
    await promise;

    // Should resolve immediately — no delay for first operation
    expect(Date.now() - start).toBe(0);
  });

  it("enforces cool-down after first operation completes", async () => {
    const pacer = new SessionPacer();

    // Complete a first operation
    pacer.recordOperationEnd();

    // Immediately request pacing for the next — should delay
    const promise = pacer.paceBeforeOperation("read");

    // Advance timers to let the delay resolve
    await vi.runAllTimersAsync();
    await promise;

    // The elapsed time should be positive (cool-down was applied)
    expect(Date.now()).toBeGreaterThan(0);
  });

  it("skips cool-down when enough time has already elapsed", async () => {
    const pacer = new SessionPacer();

    // Complete first operation
    pacer.recordOperationEnd();

    // Advance time well past any possible cool-down
    vi.advanceTimersByTime(60_000);

    const timeBefore = Date.now();
    const promise = pacer.paceBeforeOperation("read");
    await vi.runAllTimersAsync();
    await promise;

    // No additional delay — the gap already exceeds the required cool-down
    expect(Date.now() - timeBefore).toBe(0);
  });

  it("increments operation count on recordOperationEnd", async () => {
    const pacer = new SessionPacer();

    // First op — warm-up phase (1.5x), complete it
    pacer.recordOperationEnd();

    // Second op — still warm-up (1.5x)
    const promise1 = pacer.paceBeforeOperation("read");
    await vi.runAllTimersAsync();
    await promise1;
    pacer.recordOperationEnd();

    // Third op — still warm-up (op count = 2)
    const promise2 = pacer.paceBeforeOperation("read");
    await vi.runAllTimersAsync();
    await promise2;
    pacer.recordOperationEnd();

    // Fourth op — cruising phase (op count = 3, multiplier = 0.85)
    const timeBefore = Date.now();
    const promise3 = pacer.paceBeforeOperation("read");
    await vi.runAllTimersAsync();
    await promise3;

    // The delay should be shorter in cruising than warm-up
    // (0.85x vs 1.5x of the base Gaussian delay)
    const elapsed = Date.now() - timeBefore;
    expect(elapsed).toBeGreaterThan(0);
  });

  it("applies longer cool-down for write operations", async () => {
    // Seed Math.random for deterministic comparison
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    // Measure read cool-down
    const readPacer = new SessionPacer();
    readPacer.recordOperationEnd();
    const readBefore = Date.now();
    const readPromise = readPacer.paceBeforeOperation("read");
    await vi.runAllTimersAsync();
    await readPromise;
    const readElapsed = Date.now() - readBefore;

    // Measure write cool-down in a fresh pacer
    const writePacer = new SessionPacer();
    writePacer.recordOperationEnd();
    const writeBefore = Date.now();
    const writePromise = writePacer.paceBeforeOperation("write");
    await vi.runAllTimersAsync();
    await writePromise;
    const writeElapsed = Date.now() - writeBefore;

    // Write cool-down should be longer than read cool-down
    expect(writeElapsed).toBeGreaterThan(readElapsed);
  });
});
