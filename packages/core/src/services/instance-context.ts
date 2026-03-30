// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { DatabaseClient, type DatabaseClientOptions, discoverDatabase } from "../db/index.js";
import { discoverInstancePort, findApp, resolveAppPort } from "../cdp/index.js";
import type { UIHealthStatus } from "../types/index.js";
import { isCdpPort } from "../utils/cdp-port.js";
import { InstanceService } from "./instance.js";
import { LauncherService } from "./launcher.js";
import { InstanceNotRunningError, UIBlockedError } from "./errors.js";

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
 * When {@link cdpPort} is omitted, the instance port is auto-discovered
 * via {@link resolveAppPort}.  When the provided port is an instance
 * port (rather than a launcher port), it is used directly.
 *
 * A launcher connection is opened alongside the instance so that
 * post-evaluation UI health checks can detect blocking dialogs and
 * popups.  If the launcher connection fails the operation proceeds
 * without health checking.
 *
 * @throws {InstanceNotRunningError} if no instance port can be discovered.
 */
export async function withInstanceDatabase<T>(
  cdpPort: number | undefined,
  accountId: number,
  callback: (ctx: InstanceDatabaseContext) => T | Promise<T>,
  options?: {
    instanceTimeout?: number;
    db?: DatabaseClientOptions;
    launcher?: { host?: string; allowRemote?: boolean };
  },
): Promise<T> {
  const { instancePort, launcherPort } = await resolveInstancePort(cdpPort);

  const instance = new InstanceService(
    instancePort,
    options?.instanceTimeout != null ? { timeout: options.instanceTimeout } : undefined,
  );
  let launcher: LauncherService | null = null;
  let db: DatabaseClient | null = null;

  try {
    await instance.connect();

    // Open a launcher connection for health checking.
    if (launcherPort !== null) {
      try {
        launcher = new LauncherService(launcherPort, options?.launcher);
        await launcher.connect();
        const connectedLauncher = launcher;
        instance.setHealthChecker(async () => {
          const [launcherHealth, instancePopups] = await Promise.all([
            connectedLauncher.checkUIHealth(accountId),
            instance.getInstancePopups(),
          ]);
          const health: UIHealthStatus = {
            ...launcherHealth,
            instancePopups: [...launcherHealth.instancePopups, ...instancePopups],
            healthy: launcherHealth.healthy && instancePopups.length === 0,
          };
          if (!health.healthy) {
            throw new UIBlockedError(health);
          }
        });
      } catch {
        // Launcher connection failed — proceed without health checking.
        launcher?.disconnect();
        launcher = null;
      }
    }

    const dbPath = discoverDatabase(accountId);
    db = new DatabaseClient(dbPath, options?.db);
    return await callback({ accountId, instance, db });
  } finally {
    instance.setHealthChecker(null);
    instance.disconnect();
    launcher?.disconnect();
    db?.close();
  }
}

/**
 * Resolve the instance and launcher ports from the provided cdpPort.
 *
 * When cdpPort is undefined, auto-discovers via {@link resolveAppPort}.
 * When cdpPort is a launcher port, discovers instance from its children.
 * When cdpPort is an instance port, uses it directly.
 */
async function resolveInstancePort(
  cdpPort: number | undefined,
): Promise<{ instancePort: number; launcherPort: number | null }> {
  // Auto-discover when no port provided
  if (cdpPort === undefined) {
    const instancePort = await resolveAppPort("instance");
    // Try to find a launcher port for health checking
    let launcherPort: number | null = null;
    try {
      launcherPort = await resolveAppPort("launcher");
    } catch {
      // Launcher not available — proceed without it
    }
    return { instancePort, launcherPort };
  }

  // Try launcher-based discovery (current behavior)
  const instancePort = await discoverInstancePort(cdpPort);
  if (instancePort !== null) {
    return { instancePort, launcherPort: cdpPort };
  }

  // The provided port might be an instance port itself.
  // findApp() is best-effort — if it fails or does not list the port,
  // we fall back to probing the port directly with isCdpPort.  When the
  // port is valid, InstanceService.connect will succeed regardless of
  // what findApp() reports.
  let launcherPort: number | null = null;
  try {
    const apps = await findApp();
    const match = apps.find(
      (a) => a.cdpPort === cdpPort && a.role === "instance" && a.connectable,
    );
    if (match) {
      const launcherMatch = apps.find(
        (a) => a.role === "launcher" && a.connectable && a.cdpPort !== null,
      );
      return { instancePort: cdpPort, launcherPort: launcherMatch?.cdpPort ?? null };
    }
    // Capture launcher port even when the instance match fails —
    // we may still succeed via the CDP probe below.
    const launcherApp = apps.find(
      (a) => a.role === "launcher" && a.connectable && a.cdpPort !== null,
    );
    launcherPort = launcherApp?.cdpPort ?? null;
  } catch {
    // findApp() failed — fall through to CDP probe
  }

  // Last resort: probe the port directly, but reject known launcher ports
  // to avoid connecting InstanceService to a launcher (which would fail
  // with a confusing error instead of InstanceNotRunningError).
  if (cdpPort !== launcherPort && await isCdpPort(cdpPort)) {
    return { instancePort: cdpPort, launcherPort };
  }

  throw new InstanceNotRunningError(
    "No LinkedHelper instance is running. Use start-instance first.",
  );
}
