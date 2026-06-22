// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./process-inspector.js", () => ({
  scanRunningInstances: vi.fn(),
}));

vi.mock("../utils/cdp-port.js", () => ({
  isCdpPort: vi.fn(),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import { scanRunningInstances } from "./process-inspector.js";
import type { RunningInstance } from "./process-inspector.js";
import { isCdpPort } from "../utils/cdp-port.js";
import {
  InstanceReadinessTracker,
  waitForConnectable,
} from "./instance-readiness.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstance(
  overrides: Partial<RunningInstance> = {},
): RunningInstance {
  return {
    pid: 100,
    accountId: 42,
    cdpPort: 55001,
    connectable: true,
    helperChildCount: 0,
    source: "cmdline",
    confidence: "high",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// InstanceReadinessTracker
// ---------------------------------------------------------------------------

describe("InstanceReadinessTracker", () => {
  it("returns connectable for a healthy instance", () => {
    const tracker = new InstanceReadinessTracker();
    const result = tracker.update([makeInstance({ connectable: true })]);
    expect(result.get(100)).toBe("connectable");
  });

  it("returns starting for a PID never seen connectable", () => {
    const tracker = new InstanceReadinessTracker();
    const result = tracker.update([makeInstance({ connectable: false })]);
    expect(result.get(100)).toBe("starting");
  });

  it("returns degraded for a PID that was connectable and is now not (within grace)", () => {
    const tracker = new InstanceReadinessTracker();
    // First scan: connectable
    tracker.update([makeInstance({ connectable: true })]);
    // Second scan: not connectable (within the 30s grace window)
    const result = tracker.update([makeInstance({ connectable: false })]);
    expect(result.get(100)).toBe("degraded");
  });

  it("returns stuck when unreachable past the grace window", () => {
    const tracker = new InstanceReadinessTracker();
    // Make the tracker think we have been unreachable for 31 s
    tracker.update([makeInstance({ connectable: false })], 0);
    // Any subsequent scan with grace=0 should immediately be stuck
    const result = tracker.update([makeInstance({ connectable: false })], 0);
    expect(result.get(100)).toBe("stuck");
  });

  it("resets to connectable after recovery", () => {
    const tracker = new InstanceReadinessTracker();
    tracker.update([makeInstance({ connectable: false })]);
    const result = tracker.update([makeInstance({ connectable: true })]);
    expect(result.get(100)).toBe("connectable");
  });

  it("prunes PIDs that are no longer running", () => {
    const tracker = new InstanceReadinessTracker();
    tracker.update([makeInstance({ connectable: false })]);
    // PID 100 disappears
    const result = tracker.update([]);
    expect(result.has(100)).toBe(false);
  });

  it("invalidate(pid) clears state for that PID only", () => {
    const tracker = new InstanceReadinessTracker();
    // Mark both PIDs as previously connectable
    tracker.update([
      makeInstance({ pid: 100, connectable: true }),
      makeInstance({ pid: 200, connectable: true }),
    ]);
    // Now both go non-connectable
    tracker.update([
      makeInstance({ pid: 100, connectable: false }),
      makeInstance({ pid: 200, connectable: false }),
    ]);
    // Invalidate only PID 100
    tracker.invalidate(100);
    // Re-scan
    const result = tracker.update([
      makeInstance({ pid: 100, connectable: false }),
      makeInstance({ pid: 200, connectable: false }),
    ]);
    // PID 100 cleared → starting; PID 200 still has history → degraded
    expect(result.get(100)).toBe("starting");
    expect(result.get(200)).toBe("degraded");
  });
});

// ---------------------------------------------------------------------------
// waitForConnectable
// ---------------------------------------------------------------------------

describe("waitForConnectable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns immediately when instance is connectable on first scan", async () => {
    vi.mocked(scanRunningInstances).mockResolvedValue([
      makeInstance({ accountId: 42, connectable: true, cdpPort: 55001, pid: 100 }),
    ]);

    const result = await waitForConnectable(42, { timeoutMs: 5_000, intervalMs: 10 });
    expect(result).toEqual({ cdpPort: 55001, pid: 100, verified: true });
    expect(vi.mocked(scanRunningInstances)).toHaveBeenCalledTimes(1);
  });

  it("returns verified:false when instance never becomes connectable", async () => {
    vi.mocked(scanRunningInstances).mockResolvedValue([
      makeInstance({ accountId: 42, connectable: false }),
    ]);

    const result = await waitForConnectable(42, { timeoutMs: 10, intervalMs: 5 });
    expect(result.verified).toBe(false);
  });

  it("uses cheap isCdpPort probe when knownPort is supplied", async () => {
    vi.mocked(isCdpPort).mockResolvedValue(true);
    vi.mocked(scanRunningInstances).mockResolvedValue([
      makeInstance({ accountId: 42, connectable: true, cdpPort: 55001, pid: 100 }),
    ]);

    const result = await waitForConnectable(42, {
      timeoutMs: 5_000,
      intervalMs: 10,
      knownPort: 55001,
    });
    expect(vi.mocked(isCdpPort)).toHaveBeenCalledWith(55001);
    expect(result.verified).toBe(true);
  });

  it("falls through to full scan when knownPort probe fails", async () => {
    vi.mocked(isCdpPort).mockResolvedValue(false);
    vi.mocked(scanRunningInstances).mockResolvedValue([
      makeInstance({ accountId: 42, connectable: true, cdpPort: 55002, pid: 200 }),
    ]);

    const result = await waitForConnectable(42, {
      timeoutMs: 5_000,
      intervalMs: 10,
      knownPort: 55001,
    });
    expect(result.verified).toBe(true);
    expect(result.cdpPort).toBe(55002);
  });

  it("retries until the deadline", async () => {
    let calls = 0;
    vi.mocked(scanRunningInstances).mockImplementation(async () => {
      calls++;
      if (calls >= 3) {
        return [makeInstance({ accountId: 42, connectable: true, cdpPort: 55001, pid: 100 })];
      }
      return [makeInstance({ accountId: 42, connectable: false })];
    });

    const result = await waitForConnectable(42, { timeoutMs: 5_000, intervalMs: 10 });
    expect(result.verified).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("does not match an instance with a different accountId", async () => {
    vi.mocked(scanRunningInstances).mockResolvedValue([
      makeInstance({ accountId: 99, connectable: true, cdpPort: 55001 }),
    ]);

    const result = await waitForConnectable(42, { timeoutMs: 10, intervalMs: 5 });
    expect(result.verified).toBe(false);
  });
});
