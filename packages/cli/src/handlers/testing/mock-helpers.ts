import { vi } from "vitest";

import type {
  DatabaseClient,
  DatabaseContext,
  InstanceDatabaseContext,
  LauncherService,
} from "@lhremote/core";
import {
  DatabaseClient as DatabaseClientCtor,
  LauncherService as LauncherServiceCtor,
  discoverAllDatabases,
  resolveAccount,
  withDatabase,
  withInstanceDatabase,
} from "@lhremote/core";

/**
 * Mock {@link LauncherService} with optional method overrides.
 *
 * Returns the `disconnect` spy so callers can assert cleanup.
 */
export function mockLauncher(
  overrides: Partial<LauncherService> = {},
): { disconnect: ReturnType<typeof vi.fn> } {
  const disconnect = vi.fn();
  vi.mocked(LauncherServiceCtor).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      listAccounts: vi.fn().mockResolvedValue([]),
      ...overrides,
    } as unknown as LauncherService;
  });
  return { disconnect };
}

/**
 * Mock {@link DatabaseClient} with a no-op `close` and empty `db`.
 *
 * Returns the `close` spy so callers can assert cleanup.
 */
export function mockDb(): { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn();
  vi.mocked(DatabaseClientCtor).mockImplementation(function () {
    return { close, db: {} } as unknown as DatabaseClient;
  });
  return { close };
}

/**
 * Mock {@link discoverAllDatabases} to return the given map.
 *
 * Defaults to a single account at id 1.
 */
export function mockDiscovery(
  databases: Map<number, string> = new Map([[1, "/path/to/db"]]),
): void {
  vi.mocked(discoverAllDatabases).mockReturnValue(databases);
}

/**
 * Mock {@link resolveAccount} to return the given account id.
 */
export function mockResolveAccount(accountId = 1): void {
  vi.mocked(resolveAccount).mockResolvedValue(accountId);
}

/**
 * Mock {@link withInstanceDatabase} so the callback receives a
 * synthetic {@link InstanceDatabaseContext}.
 *
 * Returns the `executeAction` spy from the mock instance.
 */
export function mockWithInstanceDatabase(): {
  executeAction: ReturnType<typeof vi.fn>;
} {
  const executeAction = vi.fn().mockResolvedValue(undefined);
  vi.mocked(withInstanceDatabase).mockImplementation(
    async (_cdpPort, _accountId, callback) => {
      const mockInstance = { executeAction };
      const mockDbObj = {};
      return callback({
        accountId: _accountId,
        instance: mockInstance,
        db: mockDbObj,
      } as unknown as InstanceDatabaseContext);
    },
  );
  return { executeAction };
}

/**
 * Mock {@link withDatabase} so the callback receives a
 * synthetic {@link DatabaseContext}.
 *
 * Returns a mock `db` object for further stubbing.
 */
export function mockWithDatabase(): { db: Record<string, unknown> } {
  const db = {};
  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) => {
      return callback({
        accountId: _accountId,
        db,
      } as unknown as DatabaseContext);
    },
  );
  return { db };
}
