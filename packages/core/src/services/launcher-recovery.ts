// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { CDPConnectionError } from "../cdp/index.js";
import { LinkedHelperUnreachableError } from "./errors.js";
import { DEFAULT_LAUNCHER_RECOVERY_TIMEOUT_MS, type LauncherService } from "./launcher.js";

// Re-export so consumers can import everything from launcher-recovery.
export { DEFAULT_LAUNCHER_RECOVERY_TIMEOUT_MS } from "./launcher.js";

/**
 * Options for {@link withLauncherRecovery}.
 */
export interface LauncherRecoveryOptions {
  /**
   * Maximum time in milliseconds to spend re-discovering and reconnecting to
   * the launcher CDP after a connection error.  Defaults to
   * {@link DEFAULT_LAUNCHER_RECOVERY_TIMEOUT_MS} (30 000 ms).
   *
   * Can also be set globally via `LHREMOTE_LAUNCHER_RECOVERY_TIMEOUT_MS`.
   */
  timeoutMs?: number;
}

/**
 * Return type of {@link withLauncherRecovery}.
 */
export interface LauncherRecoveryResult<T> {
  /** The value returned by the operation. */
  result: T;
  /**
   * `true` when the launcher CDP connection was lost and automatically
   * recovered before the operation completed.
   */
  launcherRecovered: boolean;
}

function isLauncherConnectionError(error: unknown): boolean {
  return (
    error instanceof CDPConnectionError ||
    error instanceof LinkedHelperUnreachableError
  );
}

/**
 * Run a launcher-dependent operation with automatic CDP recovery.
 *
 * Tries `op()` once.  If it throws a {@link CDPConnectionError} or
 * {@link LinkedHelperUnreachableError} the launcher's current debugging port
 * is re-discovered via OS process inspection (the port is dynamic — never
 * assumed to be 9222), the launcher is reconnected with exponential back-off,
 * and `op()` is retried once against the recovered connection.
 *
 * Recovery time is capped at `options.timeoutMs`
 * (default {@link DEFAULT_LAUNCHER_RECOVERY_TIMEOUT_MS}, 30 s), also
 * configurable via `LHREMOTE_LAUNCHER_RECOVERY_TIMEOUT_MS`.
 *
 * On permanent failure (cap exceeded), the underlying error propagates so
 * callers can surface a structured {@link LinkedHelperUnreachableError}
 * rather than a raw exception.
 *
 * @param launcher - A connected (or recently-failed) {@link LauncherService}.
 * @param op       - The operation to run.  Captures `launcher` from the outer
 *   scope; called with no arguments on both the first try and the retry.
 * @param options  - Recovery options.
 *
 * @example
 * ```ts
 * const { result: accounts, launcherRecovered } = await withLauncherRecovery(
 *   launcher,
 *   () => launcher.listAccounts(),
 * );
 * ```
 */
export async function withLauncherRecovery<T>(
  launcher: LauncherService,
  op: () => Promise<T>,
  options?: LauncherRecoveryOptions,
): Promise<LauncherRecoveryResult<T>> {
  // Fast path: no connection error, return immediately.
  try {
    const result = await op();
    return { result, launcherRecovered: false };
  } catch (error) {
    if (!isLauncherConnectionError(error)) {
      throw error;
    }
  }

  // Connection error detected — attempt recovery.
  const timeoutMs =
    options?.timeoutMs ??
    (process.env["LHREMOTE_LAUNCHER_RECOVERY_TIMEOUT_MS"]
      ? Number(process.env["LHREMOTE_LAUNCHER_RECOVERY_TIMEOUT_MS"])
      : DEFAULT_LAUNCHER_RECOVERY_TIMEOUT_MS);

  // reconnect() re-discovers the current port via OS process inspection,
  // retries with back-off, and throws LinkedHelperUnreachableError on cap.
  await launcher.reconnect({ timeoutMs });

  const result = await op();
  return { result, launcherRecovered: true };
}
