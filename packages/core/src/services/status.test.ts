// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/index.js", () => ({
  discoverInstancePort: vi.fn(),
  findApp: vi.fn(),
  resolveAppPort: vi.fn(),
  resolveLauncherPort: vi.fn(),
  scanRunningInstances: vi.fn().mockResolvedValue([]),
  readinessTracker: {
    update: vi.fn().mockReturnValue(new Map()),
  },
}));

// Helper: a minimal RunningInstance (process-inspection based)
function makeRunningInstance(overrides: Partial<{
  accountId: number | null; name: string; email: string; pid: number;
  cdpPort: number | null; connectable: boolean; helperChildCount: number;
  source: "cmdline" | "cdp" | "launcher"; confidence: "high" | "low" | "unknown";
}> = {}) {
  return {
    accountId: 1, name: "Alice", email: "alice@example.com",
    pid: 12345, cdpPort: 54321, connectable: true,
    helperChildCount: 0, source: "cmdline" as const, confidence: "high" as const,
    ...overrides,
  };
}

vi.mock("../db/index.js", () => ({
  DatabaseClient: vi.fn(),
  discoverAllDatabases: vi.fn(),
}));

vi.mock("./launcher.js", () => ({
  LauncherService: vi.fn(),
}));

import { discoverInstancePort, findApp, resolveLauncherPort, scanRunningInstances } from "../cdp/index.js";
import { DatabaseClient, discoverAllDatabases } from "../db/index.js";
import { LauncherService } from "./launcher.js";
import { checkStatus } from "./status.js";

const mockedLauncherService = vi.mocked(LauncherService);
const mockedDiscoverInstancePort = vi.mocked(discoverInstancePort);
const mockedFindApp = vi.mocked(findApp);
const mockedResolveLauncherPort = vi.mocked(resolveLauncherPort);
const mockedScanRunningInstances = vi.mocked(scanRunningInstances);
const mockedDiscoverAllDatabases = vi.mocked(discoverAllDatabases);
const mockedDatabaseClient = vi.mocked(DatabaseClient);

function mockLauncher(overrides: Partial<LauncherService> = {}) {
  const disconnect = vi.fn();
  mockedLauncherService.mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      listAccounts: vi.fn().mockResolvedValue([]),
      ...overrides,
    } as unknown as LauncherService;
  });
  return { disconnect };
}

describe("checkStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: pass through explicit port, auto-discover returns 9222
    mockedResolveLauncherPort.mockImplementation(async (port) => port ?? 9222);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports launcher as not reachable when connect fails", async () => {
    mockedLauncherService.mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });
    mockedFindApp.mockResolvedValue([]);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());

    const report = await checkStatus(9222);

    expect(report.launcher).toEqual({ reachable: false, port: 9222 });
    expect(report.instances).toEqual([]);
    expect(report.databases).toEqual([]);
    expect(report.warnings).toEqual([
      "Launcher not reachable on port 9222: connection refused",
    ]);
  });

  it("still discovers databases when launcher is not reachable", async () => {
    mockedLauncherService.mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });
    mockedFindApp.mockResolvedValue([]);

    const dbMap = new Map<number, string>();
    dbMap.set(1, "/path/to/db.db");
    mockedDiscoverAllDatabases.mockReturnValue(dbMap);

    const mockClose = vi.fn();
    const mockPrepare = vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ cnt: 10 }),
    });
    mockedDatabaseClient.mockImplementation(function () {
      return { db: { prepare: mockPrepare }, close: mockClose } as unknown as DatabaseClient;
    });

    const report = await checkStatus(9222);

    expect(report.launcher.reachable).toBe(false);
    expect(report.instances).toEqual([]);
    expect(report.databases).toEqual([
      { accountId: 1, path: "/path/to/db.db", profileCount: 10 },
    ]);
    expect(report.warnings).toEqual([
      "Launcher not reachable on port 9222: connection refused",
    ]);
    expect(mockedDiscoverAllDatabases).toHaveBeenCalledOnce();
  });

  it("reports launcher as reachable when connect succeeds", async () => {
    mockLauncher();
    mockedDiscoverInstancePort.mockResolvedValue(null);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());

    const report = await checkStatus(9222);

    expect(report.launcher).toEqual({ reachable: true, port: 9222 });
  });

  it("uses provided cdpPort", async () => {
    mockLauncher();
    mockedDiscoverInstancePort.mockResolvedValue(null);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());

    const report = await checkStatus(4567);

    expect(report.launcher.port).toBe(4567);
    expect(mockedLauncherService).toHaveBeenCalledWith(4567, undefined);
  });

  it("auto-discovers launcher port when cdpPort omitted", async () => {
    mockedResolveLauncherPort.mockResolvedValue(9222);
    mockLauncher();
    mockedDiscoverInstancePort.mockResolvedValue(null);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());

    const report = await checkStatus();

    expect(mockedResolveLauncherPort).toHaveBeenCalledWith(undefined, undefined, 0);
    expect(report.launcher.port).toBe(9222);
  });

  it("instances[] comes from process inspection (not launcher listAccounts)", async () => {
    mockLauncher();
    mockedDiscoverInstancePort.mockResolvedValue(54321);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());
    mockedScanRunningInstances.mockResolvedValue([
      makeRunningInstance({ accountId: 347559, name: "Vira Lyn", cdpPort: 50297 }),
    ]);

    const report = await checkStatus(9222);

    // instances[] reflects what scanRunningInstances() returns, not listAccounts()
    expect(report.instances).toHaveLength(1);
    expect(report.instances[0]).toMatchObject({ accountId: 347559, name: "Vira Lyn", cdpPort: 50297 });
  });

  it("instances[] and runningInstances[] are the same array reference", async () => {
    mockLauncher();
    mockedDiscoverInstancePort.mockResolvedValue(null);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());
    mockedScanRunningInstances.mockResolvedValue([
      makeRunningInstance({ accountId: 347559, cdpPort: 50297 }),
      makeRunningInstance({ accountId: 329925, cdpPort: 56429, pid: 13640 }),
    ]);

    const report = await checkStatus(9222);

    // instances is an alias for runningInstances
    expect(report.instances).toBe(report.runningInstances);
    expect(report.instances).toHaveLength(2);
  });

  it("reports empty instances when no instances are running (launcher up)", async () => {
    mockLauncher();
    mockedDiscoverInstancePort.mockResolvedValue(null);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());
    mockedScanRunningInstances.mockResolvedValue([]);

    const report = await checkStatus(9222);

    expect(report.instances).toEqual([]);
    expect(report.launcher.reachable).toBe(true);
    // No warning when launcher is reachable and no instances is valid state
    expect(report.warnings).toBeUndefined();
  });

  it("instances[] is populated even when launcher CDP is down", async () => {
    mockedLauncherService.mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });
    mockedFindApp.mockResolvedValue([]);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());
    mockedScanRunningInstances.mockResolvedValue([
      makeRunningInstance({ accountId: 347559, cdpPort: 50297 }),
    ]);

    const report = await checkStatus(9222);

    expect(report.launcher.reachable).toBe(false);
    // instances still populated from process inspection despite launcher being down
    expect(report.instances).toHaveLength(1);
    expect(report.instances[0]).toMatchObject({ accountId: 347559, cdpPort: 50297 });
  });

  it("reports databases with profile counts", async () => {
    mockLauncher();
    mockedDiscoverInstancePort.mockResolvedValue(null);

    const dbMap = new Map<number, string>();
    dbMap.set(1, "/path/to/db1.db");
    dbMap.set(2, "/path/to/db2.db");
    mockedDiscoverAllDatabases.mockReturnValue(dbMap);

    const mockClose = vi.fn();
    const mockPrepare = vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ cnt: 42 }),
    });
    mockedDatabaseClient.mockImplementation(function () {
      return { db: { prepare: mockPrepare }, close: mockClose } as unknown as DatabaseClient;
    });

    const report = await checkStatus(9222);

    expect(report.databases).toEqual([
      { accountId: 1, path: "/path/to/db1.db", profileCount: 42 },
      { accountId: 2, path: "/path/to/db2.db", profileCount: 42 },
    ]);
    expect(mockClose).toHaveBeenCalledTimes(2);
  });

  it("reports profileCount 0 when database is unreadable", async () => {
    mockLauncher();
    mockedDiscoverInstancePort.mockResolvedValue(null);

    const dbMap = new Map<number, string>();
    dbMap.set(1, "/path/to/db.db");
    mockedDiscoverAllDatabases.mockReturnValue(dbMap);

    mockedDatabaseClient.mockImplementation(function () {
      throw new Error("SQLITE_CANTOPEN");
    });

    const report = await checkStatus(9222);

    expect(report.databases).toEqual([
      { accountId: 1, path: "/path/to/db.db", profileCount: 0 },
    ]);
    expect(report.warnings).toEqual([
      "Database unreadable at /path/to/db.db: SQLITE_CANTOPEN",
    ]);
  });

  it("reports empty databases when discovery fails", async () => {
    mockLauncher();
    mockedDiscoverInstancePort.mockResolvedValue(null);
    mockedDiscoverAllDatabases.mockImplementation(() => {
      throw new Error("no such directory");
    });

    const report = await checkStatus(9222);

    expect(report.databases).toEqual([]);
    expect(report.warnings).toEqual([
      "Failed to discover databases: no such directory",
    ]);
  });

  it("omits warnings when no errors occur", async () => {
    mockLauncher();
    mockedDiscoverInstancePort.mockResolvedValue(null);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());

    const report = await checkStatus(9222);

    expect(report.warnings).toBeUndefined();
  });

  it("accumulates multiple warnings from different stages", async () => {
    mockedLauncherService.mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });
    mockedFindApp.mockResolvedValue([]);
    mockedDiscoverAllDatabases.mockImplementation(() => {
      throw new Error("no dir");
    });

    const report = await checkStatus(9222);

    expect(report.warnings).toHaveLength(2);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Launcher not reachable/),
        expect.stringMatching(/Failed to discover databases/),
      ]),
    );
  });

  it("disconnects launcher after querying accounts", async () => {
    const { disconnect } = mockLauncher();
    mockedDiscoverInstancePort.mockResolvedValue(null);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());

    await checkStatus(9222);

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects launcher even when listAccounts fails", async () => {
    const { disconnect } = mockLauncher({
      listAccounts: vi.fn().mockRejectedValue(new Error("eval error")),
    });
    mockedDiscoverAllDatabases.mockReturnValue(new Map());

    await checkStatus(9222);

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
