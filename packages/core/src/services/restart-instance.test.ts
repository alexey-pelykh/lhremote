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
      // Passthrough — execute op immediately, no settle
      async (op: () => Promise<unknown>) => op(),
    ),
    invalidateProcessCache: vi.fn(),
  };
});

vi.mock("./instance-lifecycle.js", () => ({
  startInstanceWithRecovery: vi.fn(),
  waitForPidExit: vi.fn().mockResolvedValue(undefined),
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
import { startInstanceWithRecovery, waitForPidExit } from "./instance-lifecycle.js";
import { restartInstance } from "./restart-instance.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstance(overrides: Partial<RunningInstance> = {}): RunningInstance {
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

const mockLauncher = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn(),
  stopInstance: vi.fn().mockResolvedValue(undefined),
  startInstance: vi.fn().mockResolvedValue(undefined),
  listAccounts: vi.fn().mockResolvedValue([]),
} as unknown as import("./launcher.js").LauncherService;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("restartInstance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns restarted:false when instance is already connectable and force is false", async () => {
    vi.mocked(scanRunningInstances).mockResolvedValue([
      makeInstance({ accountId: 42, connectable: true, pid: 100, cdpPort: 55001 }),
    ]);

    const result = await restartInstance(mockLauncher, 42, 9222);

    expect(result.restarted).toBe(false);
    expect(result.verified).toBe(true);
    expect(result.oldPid).toBe(100);
    expect(vi.mocked(mockLauncher.stopInstance)).not.toHaveBeenCalled();
  });

  it("restarts when force:true even if already connectable", async () => {
    vi.mocked(scanRunningInstances).mockResolvedValue([
      makeInstance({ accountId: 42, connectable: true, pid: 100, cdpPort: 55001 }),
    ]);
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "started",
      port: 55002,
      pid: 200,
      verified: true,
    });
    vi.mocked(waitForConnectable).mockResolvedValue({
      cdpPort: 55002,
      pid: 200,
      verified: true,
    });

    const result = await restartInstance(mockLauncher, 42, 9222, { force: true });

    expect(result.restarted).toBe(true);
    expect(vi.mocked(mockLauncher.stopInstance)).toHaveBeenCalledWith(42);
    expect(vi.mocked(waitForPidExit)).toHaveBeenCalledWith(100);
  });

  it("happy path: stop→exit→start→connectable", async () => {
    // Initial scan: instance running
    vi.mocked(scanRunningInstances).mockResolvedValue([
      makeInstance({ accountId: 42, connectable: false, pid: 100 }),
    ]);
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "started",
      port: 55002,
      pid: 200,
      verified: true,
    });
    vi.mocked(waitForConnectable).mockResolvedValue({
      cdpPort: 55002,
      pid: 200,
      verified: true,
    });

    const result = await restartInstance(mockLauncher, 42, 9222);

    expect(result.restarted).toBe(true);
    expect(result.oldPid).toBe(100);
    expect(result.newPid).toBe(200);
    expect(result.cdpPort).toBe(55002);
    expect(result.verified).toBe(true);
    expect(vi.mocked(waitForPidExit)).toHaveBeenCalledWith(100);
  });

  it("returns verified:false when start times out", async () => {
    vi.mocked(scanRunningInstances).mockResolvedValue([
      makeInstance({ accountId: 42, connectable: false, pid: 100 }),
    ]);
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({ status: "timeout" });

    const result = await restartInstance(mockLauncher, 42, 9222);

    expect(result.restarted).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.cdpPort).toBeNull();
  });

  it("does not stop other accounts' instances", async () => {
    // Two instances: 42 (target) and 99 (other)
    vi.mocked(scanRunningInstances).mockResolvedValue([
      makeInstance({ accountId: 42, connectable: false, pid: 100 }),
      makeInstance({ accountId: 99, connectable: true, pid: 999, cdpPort: 56000 }),
    ]);
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "started",
      port: 55002,
      pid: 200,
      verified: true,
    });
    vi.mocked(waitForConnectable).mockResolvedValue({
      cdpPort: 55002,
      pid: 200,
      verified: true,
    });

    await restartInstance(mockLauncher, 42, 9222);

    // stopInstance called only for account 42
    expect(vi.mocked(mockLauncher.stopInstance)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mockLauncher.stopInstance)).toHaveBeenCalledWith(42);
  });

  it("marks verified:false when new port is phantom duplicate of old port", async () => {
    vi.mocked(scanRunningInstances).mockResolvedValue([
      makeInstance({ accountId: 42, connectable: true, pid: 100, cdpPort: 55001 }),
    ]);
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "started",
      port: 55001, // Same port as before — phantom
      pid: 200,
      verified: true,
    });
    vi.mocked(waitForConnectable).mockResolvedValue({
      cdpPort: 55001, // Same port
      pid: 200,
      verified: true,
    });

    const result = await restartInstance(mockLauncher, 42, 9222, { force: true });

    // Port is the same as the old one — consider phantom (not distinct)
    expect(result.verified).toBe(false);
  });
});
