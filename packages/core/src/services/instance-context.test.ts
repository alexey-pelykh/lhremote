// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/index.js", () => ({
  discoverInstancePort: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  DatabaseClient: vi.fn(),
  discoverDatabase: vi.fn(),
}));

vi.mock("./instance.js", () => ({
  InstanceService: vi.fn(),
}));

vi.mock("./launcher.js", () => ({
  LauncherService: vi.fn(),
}));

import { discoverInstancePort } from "../cdp/index.js";
import { DatabaseClient, discoverDatabase } from "../db/index.js";
import { InstanceService } from "./instance.js";
import { LauncherService } from "./launcher.js";
import { InstanceNotRunningError, UIBlockedError } from "./errors.js";
import { withDatabase, withInstanceDatabase } from "./instance-context.js";

const mockedDiscoverInstancePort = vi.mocked(discoverInstancePort);
const mockedDiscoverDatabase = vi.mocked(discoverDatabase);
const mockedDatabaseClient = vi.mocked(DatabaseClient);
const mockedInstanceService = vi.mocked(InstanceService);
const mockedLauncherService = vi.mocked(LauncherService);

function createMockDb(overrides: Partial<DatabaseClient> = {}) {
  const db = {
    close: vi.fn(),
    ...overrides,
  } as unknown as DatabaseClient;
  mockedDatabaseClient.mockImplementation(function () {
    return db;
  });
  return db;
}

function createMockInstance(overrides: Partial<InstanceService> = {}) {
  const instance = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    setHealthChecker: vi.fn(),
    getInstancePopups: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as InstanceService;
  mockedInstanceService.mockImplementation(function () {
    return instance;
  });
  return instance;
}

function createMockLauncher() {
  const launcher = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    checkUIHealth: vi.fn().mockResolvedValue({
      healthy: true,
      issues: [],
      popup: null,
      instancePopups: [],
    }),
  } as unknown as LauncherService;
  mockedLauncherService.mockImplementation(function () {
    return launcher;
  });
  return launcher;
}

function extractHealthChecker(mockInstance: InstanceService): () => Promise<void> {
  const calls = vi.mocked(mockInstance.setHealthChecker).mock.calls;
  const firstCall = calls[0];
  if (!firstCall) throw new Error("setHealthChecker was not called");
  return firstCall[0] as () => Promise<void>;
}

describe("withDatabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes valid DatabaseContext to callback", async () => {
    const mockDb = createMockDb();
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    let receivedCtx: unknown;
    await withDatabase(42, (ctx) => {
      receivedCtx = ctx;
    });

    expect(receivedCtx).toEqual({ accountId: 42, db: mockDb });
  });

  it("returns the callback result", async () => {
    createMockDb();
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    const result = await withDatabase(42, () => "hello");

    expect(result).toBe("hello");
  });

  it("returns the callback result for async callbacks", async () => {
    createMockDb();
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    const result = await withDatabase(42, async () => Promise.resolve(123));

    expect(result).toBe(123);
  });

  it("closes DB after callback completes successfully", async () => {
    const mockDb = createMockDb();
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    await withDatabase(42, () => undefined);

    expect(mockDb.close).toHaveBeenCalledOnce();
  });

  it("closes DB even when callback throws", async () => {
    const mockDb = createMockDb();
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    await expect(
      withDatabase(42, () => {
        throw new Error("callback error");
      }),
    ).rejects.toThrow("callback error");

    expect(mockDb.close).toHaveBeenCalledOnce();
  });

  it("passes database options to DatabaseClient", async () => {
    createMockDb();
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    await withDatabase(42, () => undefined, { readOnly: false });

    expect(mockedDatabaseClient).toHaveBeenCalledWith("/path/to/db.db", {
      readOnly: false,
    });
  });

  it("discovers database for the given accountId", async () => {
    createMockDb();
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    await withDatabase(99, () => undefined);

    expect(mockedDiscoverDatabase).toHaveBeenCalledWith(99);
  });
});

describe("withInstanceDatabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMockLauncher();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects to instance, opens DB, and passes context to callback", async () => {
    const mockInstance = createMockInstance();
    const mockDb = createMockDb();
    mockedDiscoverInstancePort.mockResolvedValue(55123);
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    let receivedCtx: unknown;
    await withInstanceDatabase(9222, 42, (ctx) => {
      receivedCtx = ctx;
    });

    expect(mockedDiscoverInstancePort).toHaveBeenCalledWith(9222);
    expect(mockedInstanceService).toHaveBeenCalledWith(55123, undefined);
    expect(mockInstance.connect).toHaveBeenCalledOnce();
    expect(mockedDiscoverDatabase).toHaveBeenCalledWith(42);
    expect(receivedCtx).toEqual({
      accountId: 42,
      instance: mockInstance,
      db: mockDb,
    });
  });

  it("returns the callback result", async () => {
    createMockInstance();
    createMockDb();
    mockedDiscoverInstancePort.mockResolvedValue(55123);
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    const result = await withInstanceDatabase(9222, 42, () => "world");

    expect(result).toBe("world");
  });

  it("cleans up both resources on success", async () => {
    const mockInstance = createMockInstance();
    const mockDb = createMockDb();
    mockedDiscoverInstancePort.mockResolvedValue(55123);
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    await withInstanceDatabase(9222, 42, () => undefined);

    expect(mockInstance.disconnect).toHaveBeenCalledOnce();
    expect(mockDb.close).toHaveBeenCalledOnce();
  });

  it("cleans up both resources on callback failure", async () => {
    const mockInstance = createMockInstance();
    const mockDb = createMockDb();
    mockedDiscoverInstancePort.mockResolvedValue(55123);
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    await expect(
      withInstanceDatabase(9222, 42, () => {
        throw new Error("callback error");
      }),
    ).rejects.toThrow("callback error");

    expect(mockInstance.disconnect).toHaveBeenCalledOnce();
    expect(mockDb.close).toHaveBeenCalledOnce();
  });

  it("disconnects instance when connect fails (db never opened)", async () => {
    const mockInstance = createMockInstance({
      connect: vi.fn().mockRejectedValue(new Error("connect failed")),
      disconnect: vi.fn(),
    });
    mockedDiscoverInstancePort.mockResolvedValue(55123);

    await expect(
      withInstanceDatabase(9222, 42, () => undefined),
    ).rejects.toThrow("connect failed");

    expect(mockInstance.disconnect).toHaveBeenCalledOnce();
    // DB was never created, so close should not have been called
    expect(mockedDatabaseClient).not.toHaveBeenCalled();
  });

  it("throws InstanceNotRunningError when no instance port discovered", async () => {
    mockedDiscoverInstancePort.mockResolvedValue(null);

    await expect(
      withInstanceDatabase(9222, 42, () => undefined),
    ).rejects.toThrow(InstanceNotRunningError);
  });

  it("passes instanceTimeout option to InstanceService", async () => {
    createMockInstance();
    createMockDb();
    mockedDiscoverInstancePort.mockResolvedValue(55123);
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    await withInstanceDatabase(9222, 42, () => undefined, {
      instanceTimeout: 5000,
    });

    expect(mockedInstanceService).toHaveBeenCalledWith(55123, {
      timeout: 5000,
    });
  });

  it("passes db options to DatabaseClient", async () => {
    createMockInstance();
    createMockDb();
    mockedDiscoverInstancePort.mockResolvedValue(55123);
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    await withInstanceDatabase(9222, 42, () => undefined, {
      db: { readOnly: false },
    });

    expect(mockedDatabaseClient).toHaveBeenCalledWith("/path/to/db.db", {
      readOnly: false,
    });
  });

  it("passes undefined to InstanceService when no timeout specified", async () => {
    createMockInstance();
    createMockDb();
    mockedDiscoverInstancePort.mockResolvedValue(55123);
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    await withInstanceDatabase(9222, 42, () => undefined);

    expect(mockedInstanceService).toHaveBeenCalledWith(55123, undefined);
  });

  it("health checker calls getInstancePopups alongside launcher health", async () => {
    const mockInstance = createMockInstance();
    const mockLauncher = createMockLauncher();
    createMockDb();
    mockedDiscoverInstancePort.mockResolvedValue(55123);
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    await withInstanceDatabase(9222, 42, () => undefined);

    // Extract and invoke the registered health checker
    const healthChecker = extractHealthChecker(mockInstance);

    await healthChecker();

    expect(vi.mocked(mockLauncher.checkUIHealth)).toHaveBeenCalledWith(42);
    expect(vi.mocked(mockInstance.getInstancePopups)).toHaveBeenCalledOnce();
  });

  it("health checker throws UIBlockedError when instance popups detected", async () => {
    const mockInstance = createMockInstance({
      getInstancePopups: vi.fn().mockResolvedValue([
        { title: "Failed to initialize UI", description: "Error details", closable: false },
      ]),
    });
    createMockLauncher();
    createMockDb();
    mockedDiscoverInstancePort.mockResolvedValue(55123);
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    await withInstanceDatabase(9222, 42, () => undefined);

    const healthChecker = extractHealthChecker(mockInstance);

    await expect(healthChecker()).rejects.toThrow(UIBlockedError);
    await expect(healthChecker()).rejects.toThrow("Instance popup: Failed to initialize UI");
  });

  it("health checker throws UIBlockedError with both launcher issues and instance popups", async () => {
    const mockInstance = createMockInstance({
      getInstancePopups: vi.fn().mockResolvedValue([
        { title: "Error popup", closable: true },
      ]),
    });
    const mockLauncher = createMockLauncher();
    vi.mocked(mockLauncher.checkUIHealth).mockResolvedValue({
      healthy: false,
      issues: [
        {
          type: "dialog",
          id: "d1",
          data: { id: "d1", options: { message: "Dialog message", controls: [] } },
        },
      ],
      popup: null,
      instancePopups: [],
    });
    createMockDb();
    mockedDiscoverInstancePort.mockResolvedValue(55123);
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    await withInstanceDatabase(9222, 42, () => undefined);

    const healthChecker = extractHealthChecker(mockInstance);

    const error = await healthChecker().catch((e: unknown) => e) as UIBlockedError;
    expect(error).toBeInstanceOf(UIBlockedError);
    expect(error.message).toContain("Dialog: Dialog message");
    expect(error.message).toContain("Instance popup: Error popup");
  });

  it("health checker passes when no launcher issues and no instance popups", async () => {
    const mockInstance = createMockInstance();
    createMockLauncher();
    createMockDb();
    mockedDiscoverInstancePort.mockResolvedValue(55123);
    mockedDiscoverDatabase.mockReturnValue("/path/to/db.db");

    await withInstanceDatabase(9222, 42, () => undefined);

    const healthChecker = extractHealthChecker(mockInstance);

    await expect(healthChecker()).resolves.toBeUndefined();
  });
});
