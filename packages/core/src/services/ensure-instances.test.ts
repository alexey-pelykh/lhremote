// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../cdp/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cdp/index.js")>();
  return {
    ...actual,
    scanRunningInstances: vi.fn(),
    waitForConnectable: vi.fn(),
    withLauncherQueue: vi.fn(
      async (op: () => Promise<unknown>) => op(),
    ),
    invalidateProcessCache: vi.fn(),
  };
});

vi.mock("./instance-lifecycle.js", () => ({
  startInstanceWithRecovery: vi.fn(),
}));

vi.mock("./launcher-recovery.js", () => ({
  withLauncherRecovery: vi.fn(
    async (_launcher: unknown, op: () => Promise<unknown>) => ({
      result: await op(),
      launcherRecovered: false,
    }),
  ),
}));

import { scanRunningInstances, waitForConnectable } from "../cdp/index.js";
import type { RunningInstance } from "../cdp/index.js";
import { startInstanceWithRecovery } from "./instance-lifecycle.js";
import { ensureInstances } from "./ensure-instances.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstance(overrides: Partial<RunningInstance> = {}): RunningInstance {
  return {
    pid: 100,
    accountId: 1,
    cdpPort: 55001,
    connectable: true,
    helperChildCount: 0,
    source: "cmdline",
    confidence: "high",
    ...overrides,
  };
}

const mockLauncher = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn(),
} as unknown as import("./launcher.js").LauncherService;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ensureInstances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no verified result from Phase 2
    vi.mocked(waitForConnectable).mockResolvedValue({
      cdpPort: null,
      pid: undefined,
      verified: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips accounts that are already running and connectable", async () => {
    vi.mocked(scanRunningInstances).mockResolvedValue([
      makeInstance({ accountId: 1, connectable: true, cdpPort: 55001, pid: 100 }),
    ]);

    const results = await ensureInstances([1], mockLauncher, 9222);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      accountId: 1,
      status: "already_running",
      verified: true,
    });
    expect(vi.mocked(startInstanceWithRecovery)).not.toHaveBeenCalled();
  });

  it("starts an account that is not running", async () => {
    vi.mocked(scanRunningInstances).mockResolvedValue([]);
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "started",
      port: 55001,
      pid: 100,
      verified: true,
    });

    const results = await ensureInstances([1], mockLauncher, 9222);

    expect(results[0]).toMatchObject({
      accountId: 1,
      status: "started",
      cdpPort: 55001,
    });
  });

  it("reports timeout when startInstanceWithRecovery returns timeout", async () => {
    vi.mocked(scanRunningInstances).mockResolvedValue([]);
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({ status: "timeout" });

    const results = await ensureInstances([1], mockLauncher, 9222);

    expect(results[0]).toMatchObject({ accountId: 1, status: "timeout" });
  });

  it("reports failed when startInstanceWithRecovery throws", async () => {
    vi.mocked(scanRunningInstances).mockResolvedValue([]);
    vi.mocked(startInstanceWithRecovery).mockRejectedValue(new Error("boom"));

    const results = await ensureInstances([1], mockLauncher, 9222);

    expect(results[0]).toMatchObject({
      accountId: 1,
      status: "failed",
      error: "boom",
    });
  });

  it("Phase 2: updates verified when waitForConnectable succeeds", async () => {
    vi.mocked(scanRunningInstances).mockResolvedValue([]);
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "started",
      port: 55001,
      pid: 100,
      verified: false, // Phase 1 snapshot failed
    });
    vi.mocked(waitForConnectable).mockResolvedValue({
      cdpPort: 55001,
      pid: 100,
      verified: true, // Phase 2 poll succeeded
    });

    const results = await ensureInstances([1], mockLauncher, 9222);

    expect(results[0]).toMatchObject({
      accountId: 1,
      status: "started",
      verified: true,
    });
  });

  it("Phase 2: marks failed for account whose process never appears (unlicensed)", async () => {
    vi.mocked(scanRunningInstances).mockResolvedValue([]);
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "started",
      port: 55001,
      verified: false,
    });
    // Phase 2 also times out
    vi.mocked(waitForConnectable).mockResolvedValue({
      cdpPort: null,
      pid: undefined,
      verified: false,
    });

    const results = await ensureInstances([1], mockLauncher, 9222);

    expect(results[0]).toMatchObject({
      accountId: 1,
      status: "failed",
    });
    expect(results[0]?.error).toContain("license");
  });

  it("Phase 2 runs in parallel for multiple unverified accounts", async () => {
    vi.mocked(scanRunningInstances).mockResolvedValue([]);

    const startOrder: number[] = [];
    const verifyOrder: number[] = [];

    vi.mocked(startInstanceWithRecovery).mockImplementation(
      async (_launcher, accountId) => {
        startOrder.push(accountId);
        return { status: "started" as const, port: 55000 + accountId, verified: false };
      },
    );

    vi.mocked(waitForConnectable).mockImplementation(
      async (accountId) => {
        verifyOrder.push(accountId);
        // All verifications start; we don't need to actually stagger them in tests
        return { cdpPort: 55000 + accountId, pid: accountId * 100, verified: true };
      },
    );

    const results = await ensureInstances([1, 2, 3], mockLauncher, 9222);

    // All three were started sequentially
    expect(startOrder).toEqual([1, 2, 3]);
    // All three were verified (order may vary in parallel, but all called)
    expect(verifyOrder.sort()).toEqual([1, 2, 3]);
    expect(results.every((r) => r.verified === true)).toBe(true);
  });

  it("handles mix of already-running and new accounts", async () => {
    vi.mocked(scanRunningInstances)
      .mockResolvedValueOnce([
        makeInstance({ accountId: 1, connectable: true, cdpPort: 55001, pid: 10 }),
      ])
      .mockResolvedValueOnce([
        makeInstance({ accountId: 1, connectable: true, cdpPort: 55001, pid: 10 }),
      ]);

    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "started",
      port: 55002,
      pid: 20,
      verified: true,
    });

    const results = await ensureInstances([1, 2], mockLauncher, 9222);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ accountId: 1, status: "already_running" });
    expect(results[1]).toMatchObject({ accountId: 2, status: "started" });
  });
});
