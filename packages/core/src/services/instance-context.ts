// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { DatabaseClient, type DatabaseClientOptions, discoverDatabase } from "../db/index.js";
import { discoverInstancePort } from "../cdp/index.js";
import { InstanceService } from "./instance.js";
import { InstanceNotRunningError } from "./errors.js";

/**
 * Resources available when only database access is needed.
 */
export interface DatabaseContext {
  readonly accountId: number;
  readonly db: DatabaseClient;
}

/**
 * Resources available when both instance (CDP) and database access are needed.
 */
export interface InstanceDatabaseContext {
  readonly accountId: number;
  readonly instance: InstanceService;
  readonly db: DatabaseClient;
}

/**
 * Open the account's database inside a managed scope.
 *
 * The database is automatically closed when the callback finishes
 * (whether it resolves or rejects).
 */
export async function withDatabase<T>(
  accountId: number,
  callback: (ctx: DatabaseContext) => T | Promise<T>,
  options?: DatabaseClientOptions,
): Promise<T> {
  const dbPath = discoverDatabase(accountId);
  const db = new DatabaseClient(dbPath, options);
  try {
    return await callback({ accountId, db });
  } finally {
    db.close();
  }
}

/**
 * Discover the running instance, connect to it, open the account's
 * database, and hand both to the callback.
 *
 * All resources are cleaned up automatically when the callback finishes.
 *
 * @throws {InstanceNotRunningError} if no instance port can be discovered.
 */
export async function withInstanceDatabase<T>(
  cdpPort: number,
  accountId: number,
  callback: (ctx: InstanceDatabaseContext) => T | Promise<T>,
  options?: {
    instanceTimeout?: number;
    db?: DatabaseClientOptions;
  },
): Promise<T> {
  const instancePort = await discoverInstancePort(cdpPort);
  if (instancePort === null) {
    throw new InstanceNotRunningError(
      "No LinkedHelper instance is running. Use start-instance first.",
    );
  }

  const instance = new InstanceService(
    instancePort,
    options?.instanceTimeout != null ? { timeout: options.instanceTimeout } : undefined,
  );
  let db: DatabaseClient | null = null;

  try {
    await instance.connect();
    const dbPath = discoverDatabase(accountId);
    db = new DatabaseClient(dbPath, options?.db);
    return await callback({ accountId, instance, db });
  } finally {
    instance.disconnect();
    db?.close();
  }
}
