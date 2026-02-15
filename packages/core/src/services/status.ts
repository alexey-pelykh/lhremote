// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { discoverInstancePort } from "../cdp/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import { DatabaseClient, discoverAllDatabases } from "../db/index.js";
import { ProfileRepository } from "../db/repositories/profile.js";
import { errorMessage } from "../utils/error-message.js";
import { LauncherService } from "./launcher.js";

/** Status of the LinkedHelper launcher process. */
export interface LauncherStatus {
  reachable: boolean;
  port: number;
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
 * @param cdpPort - The CDP port of the LinkedHelper launcher (default 9222).
 */
export async function checkStatus(
  cdpPort = DEFAULT_CDP_PORT,
  options?: { host?: string; allowRemote?: boolean },
): Promise<StatusReport> {
  const launcher: LauncherStatus = { reachable: false, port: cdpPort };
  const instances: AccountInstanceStatus[] = [];
  const databases: DatabaseStatus[] = [];
  const warnings: string[] = [];

  // 1. Probe launcher
  const launcherService = new LauncherService(cdpPort, options);
  try {
    await launcherService.connect();
    launcher.reachable = true;
  } catch (error: unknown) {
    warnings.push(`Launcher not reachable on port ${cdpPort.toString()}: ${errorMessage(error)}`);
  }

  // 2. List accounts and discover instance CDP ports (only if launcher is reachable)
  if (launcher.reachable) {
    try {
      const accounts = await launcherService.listAccounts();
      const instancePort = await discoverInstancePort(cdpPort);

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
