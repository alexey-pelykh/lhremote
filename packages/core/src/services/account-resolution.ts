// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveLauncherPort } from "../cdp/index.js";
import { discoverAllDatabases } from "../db/index.js";
import type { Account } from "../types/index.js";
import {
  LinkedHelperNotRunningError,
  ServiceError,
  WrongPortError,
} from "./errors.js";
import { LauncherService } from "./launcher.js";

/**
 * Thrown when account resolution fails because no accounts exist,
 * or multiple accounts exist and automatic selection is not possible.
 */
export class AccountResolutionError extends ServiceError {
  readonly reason: "no-accounts" | "multiple-accounts";

  constructor(reason: "no-accounts" | "multiple-accounts", accountIds?: number[]) {
    const message =
      reason === "no-accounts"
        ? "No accounts found."
        : accountIds && accountIds.length > 0
          ? `Multiple accounts found (${accountIds.join(", ")}). Specify accountId to select one.`
          : "Multiple accounts found. Cannot determine which instance to use.";
    super(message);
    this.name = "AccountResolutionError";
    this.reason = reason;
  }
}

/**
 * Connect to the LinkedHelper launcher, resolve the single account,
 * and return its ID.
 *
 * When {@link cdpPort} is omitted the launcher port is auto-discovered
 * via {@link resolveLauncherPort}.  If the provided port belongs to an
 * instance (not the launcher), the account is resolved from local
 * databases instead.
 *
 * @throws {LinkedHelperNotRunningError} if the launcher is unreachable
 *   and no database fallback is available.
 * @throws {AccountResolutionError} if zero or multiple accounts exist.
 */
export async function resolveAccount(
  cdpPort?: number,
  options?: { host?: string; allowRemote?: boolean; accountId?: number },
): Promise<number> {
  if (options?.accountId !== undefined) {
    return options.accountId;
  }

  let port: number;
  try {
    port = await resolveLauncherPort(cdpPort, options?.host);
  } catch (error: unknown) {
    // When cdpPort was omitted and no LinkedHelper process exists,
    // fall back to database-based resolution (the "offline" scenario).
    // LinkedHelperUnreachableError is NOT caught here: it means a
    // process exists but CDP failed transiently — propagating it
    // surfaces the real problem instead of masking it behind a
    // misleading "multiple accounts" error from stale databases.
    if (
      cdpPort === undefined &&
      error instanceof LinkedHelperNotRunningError
    ) {
      return resolveAccountFromDatabases();
    }
    throw error;
  }

  try {
    return await resolveAccountViaLauncher(port, options);
  } catch (error: unknown) {
    if (error instanceof WrongPortError) {
      // Port belongs to an instance — resolve from databases
      return resolveAccountFromDatabases();
    }
    throw error;
  }
}

/**
 * Resolve account by connecting to the launcher.
 */
async function resolveAccountViaLauncher(
  port: number,
  options?: { host?: string; allowRemote?: boolean },
): Promise<number> {
  const launcher = new LauncherService(port, options);
  try {
    await launcher.connect();

    const accounts = await launcher.listAccounts();
    if (accounts.length === 0) {
      throw new AccountResolutionError("no-accounts");
    }
    if (accounts.length > 1) {
      throw new AccountResolutionError("multiple-accounts");
    }
    return (accounts[0] as Account).id;
  } finally {
    launcher.disconnect();
  }
}

/**
 * Resolve account from locally discovered databases.
 *
 * Used as a fallback when the launcher is not available (e.g. when
 * connected directly to an instance).
 */
function resolveAccountFromDatabases(): number {
  const databases = discoverAllDatabases();
  if (databases.size === 0) {
    throw new AccountResolutionError("no-accounts");
  }
  if (databases.size > 1) {
    throw new AccountResolutionError("multiple-accounts", [...databases.keys()]);
  }
  // databases.size === 1 is guaranteed by the guards above
  const accountId = databases.keys().next().value as number;
  return accountId;
}
