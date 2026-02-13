// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/index.js", () => ({
  discoverInstancePort: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  DatabaseClient: vi.fn(),
  discoverAllDatabases: vi.fn(),
}));

vi.mock("./launcher.js", () => ({
  LauncherService: vi.fn(),
}));

import { discoverInstancePort } from "../cdp/index.js";
import { DatabaseClient, discoverAllDatabases } from "../db/index.js";
import { LauncherService } from "./launcher.js";
import { checkStatus } from "./status.js";

const mockedLauncherService = vi.mocked(LauncherService);
const mockedDiscoverInstancePort = vi.mocked(discoverInstancePort);
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
    mockedDiscoverAllDatabases.mockReturnValue(new Map());

    const report = await checkStatus(9222);

    expect(report.launcher).toEqual({ reachable: false, port: 9222 });
    expect(report.instances).toEqual([]);
    expect(report.databases).toEqual([]);
  });

  it("still discovers databases when launcher is not reachable", async () => {
    mockedLauncherService.mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

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

  it("defaults cdpPort to 9222", async () => {
    mockLauncher();
    mockedDiscoverInstancePort.mockResolvedValue(null);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());

    const report = await checkStatus();

    expect(report.launcher.port).toBe(9222);
  });

  it("reports single account with instance port", async () => {
    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([
        { id: 1, liId: 100, name: "Alice" },
      ]),
    });
    mockedDiscoverInstancePort.mockResolvedValue(54321);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());

    const report = await checkStatus(9222);

    expect(report.instances).toEqual([
      { accountId: 1, accountName: "Alice", cdpPort: 54321 },
    ]);
  });

  it("reports null cdpPort for all accounts when multiple accounts exist", async () => {
    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([
        { id: 1, liId: 100, name: "Alice" },
        { id: 2, liId: 200, name: "Bob" },
      ]),
    });
    mockedDiscoverInstancePort.mockResolvedValue(54321);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());

    const report = await checkStatus(9222);

    expect(report.instances).toEqual([
      { accountId: 1, accountName: "Alice", cdpPort: null },
      { accountId: 2, accountName: "Bob", cdpPort: null },
    ]);
  });

  it("reports null cdpPort when no instance is running", async () => {
    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([
        { id: 1, liId: 100, name: "Alice" },
      ]),
    });
    mockedDiscoverInstancePort.mockResolvedValue(null);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());

    const report = await checkStatus(9222);

    expect(report.instances[0]?.cdpPort).toBeNull();
  });

  it("reports empty instances when listAccounts fails", async () => {
    mockLauncher({
      listAccounts: vi.fn().mockRejectedValue(new Error("eval error")),
    });
    mockedDiscoverAllDatabases.mockReturnValue(new Map());

    const report = await checkStatus(9222);

    expect(report.instances).toEqual([]);
    expect(report.launcher.reachable).toBe(true);
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
  });

  it("reports empty databases when discovery fails", async () => {
    mockLauncher();
    mockedDiscoverInstancePort.mockResolvedValue(null);
    mockedDiscoverAllDatabases.mockImplementation(() => {
      throw new Error("no such directory");
    });

    const report = await checkStatus(9222);

    expect(report.databases).toEqual([]);
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
