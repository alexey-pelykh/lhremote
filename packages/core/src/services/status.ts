// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { type DiscoveredApp, discoverInstancePort, findApp, resolveLauncherPort } from "../cdp/index.js";
import { DatabaseClient, discoverAllDatabases } from "../db/index.js";
import { ProfileRepository } from "../db/repositories/profile.js";
import { errorMessage } from "../utils/error-message.js";
import { LauncherService } from "./launcher.js";

/** Status of the LinkedHelper launcher process. */
export interface LauncherStatus {
  reachable: boolean;
  port: number | null;
  /** Detected LH processes (populated only when launcher is unreachable). */
  processes?: DiscoveredApp[];
}

/** Status of a single LinkedHelper account instance. */
export interface AccountInstanceStatus {
  accountId: number;
  accountName: string;
  cdpPort: number | null;
}

/** Status of a single LinkedHelper database. */
export interface DatabaseStatus {
  accountId: number;
  path: string;
  profileCount: number;
}

/** Aggregated health-check result. */
export interface StatusReport {
  launcher: LauncherStatus;
  instances: AccountInstanceStatus[];
  databases: DatabaseStatus[];
  warnings?: string[];
}

/**
 * Perform a health check across LinkedHelper components.
 *
 * The function is intentionally fault-tolerant: individual component
 * failures are reported in the result rather than thrown as exceptions.
 *
 * When {@link cdpPort} is omitted, the launcher port is auto-discovered
 * via {@link resolveLauncherPort}.  If no launcher is available, the report
 * reflects this and still includes database and process information.
 *
 * @param cdpPort - The CDP port of the LinkedHelper launcher (auto-discovered if omitted).
 */
export async function checkStatus(
  cdpPort?: number,
  options?: { host?: string; allowRemote?: boolean },
): Promise<StatusReport> {
  // Resolve launcher port: explicit, auto-discovered, or none
  let resolvedPort: number | null;
  try {
    resolvedPort = await resolveLauncherPort(cdpPort, options?.host);
  } catch {
    resolvedPort = null;
  }

  const launcher: LauncherStatus = { reachable: false, port: resolvedPort };
  const instances: AccountInstanceStatus[] = [];
  const databases: DatabaseStatus[] = [];
  const warnings: string[] = [];

  // 1. Probe launcher
  if (resolvedPort !== null) {
    const launcherService = new LauncherService(resolvedPort, options);
    try {
      await launcherService.connect();
      launcher.reachable = true;

      // 2. List accounts and discover instance CDP ports
      try {
        const accounts = await launcherService.listAccounts();
        const instancePort = await discoverInstancePort(resolvedPort);

        for (const account of accounts) {
          // discoverInstancePort finds a single child-process port but cannot
          // determine which account owns it.  Assign the port only when there
          // is exactly one account (the common case); otherwise report null.
          instances.push({
            accountId: account.id,
            accountName: account.name,
            cdpPort: accounts.length === 1 ? instancePort : null,
          });
        }
      } catch (error: unknown) {
        warnings.push(`Failed to query accounts: ${errorMessage(error)}`);
      } finally {
        launcherService.disconnect();
      }
    } catch (error: unknown) {
      launcherService.disconnect();
      warnings.push(`Launcher not reachable on port ${resolvedPort.toString()}: ${errorMessage(error)}`);

      // Enrich with process-level detection when CDP is unreachable
      const apps = await findApp();
      if (apps.length > 0) {
        launcher.processes = apps;
        warnings.push(
          `LinkedHelper process(es) detected (PID ${apps.map((a) => String(a.pid)).join(", ")}) but CDP not reachable. Restart may be needed.`,
        );
      }
    }
  } else {
    // No launcher port — check for running processes
    const apps = await findApp();
    if (apps.length > 0) {
      launcher.processes = apps;
      const connectableInstances = apps.filter(
        (a) => a.role === "instance" && a.connectable && a.cdpPort !== null,
      );
      if (connectableInstances.length > 0) {
        warnings.push(
          "Launcher CDP not available. Instance(s) detected — " +
            "instance-level operations work, but launcher operations " +
            "(list-accounts, start/stop-instance) are unavailable. " +
            "Relaunch LinkedHelper with --remote-debugging-port or use launch-app.",
        );
      } else {
        warnings.push(
          `LinkedHelper process(es) detected (PID ${apps.map((a) => String(a.pid)).join(", ")}) ` +
            "but no CDP endpoints are reachable.",
        );
      }
    } else {
      warnings.push("LinkedHelper is not running.");
    }
  }

  // 3. Check databases
  try {
    const dbMap = discoverAllDatabases();
    for (const [accountId, dbPath] of dbMap) {
      let profileCount = 0;
      try {
        const client = new DatabaseClient(dbPath);
        try {
          const repo = new ProfileRepository(client);
          profileCount = repo.getProfileCount();
        } finally {
          client.close();
        }
      } catch (error: unknown) {
        warnings.push(`Database unreadable at ${dbPath}: ${errorMessage(error)}`);
      }
      databases.push({ accountId, path: dbPath, profileCount });
    }
  } catch (error: unknown) {
    warnings.push(`Failed to discover databases: ${errorMessage(error)}`);
  }

  return {
    launcher,
    instances,
    databases,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
