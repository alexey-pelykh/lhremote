// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { scanRunningInstances, waitForConnectable, withLauncherQueue } from "../cdp/index.js";
import { errorMessage } from "../utils/error-message.js";
import { startInstanceWithRecovery } from "./instance-lifecycle.js";
import { withLauncherRecovery } from "./launcher-recovery.js";
import type { LauncherService } from "./launcher.js";

/** Per-account result from {@link ensureInstances}. */
export interface EnsureInstanceResult {
  accountId: number;
  status:
    | "already_running"
    | "started"
    | "failed"
    | "timeout";
  cdpPort?: number;
  pid?: number;
  verified?: boolean;
  error?: string;
}

/**
 * Bring up exactly the requested set of account instances (F6 — T4 hardened).
 *
 * Changes versus v0.21.0:
 * - Each start is serialised through the launcher queue (T1) with a settle
 *   barrier between accounts, preventing launcher CDP drops under rapid load.
 * - Verification uses `waitForConnectable` (T2) instead of a one-shot snapshot,
 *   so accounts that take >1 s to settle are not incorrectly reported as
 *   `verified: false`.
 * - Phase 2 runs remaining `waitForConnectable` checks in parallel so a slow
 *   account does not block faster ones from being confirmed.
 * - An unlicensed / permanently-failed account (no process ever appears) is
 *   reported as `status: "failed"` with a clear reason rather than a phantom
 *   success.
 *
 * @param accountIds   - The set of account IDs that should be running.
 * @param launcher     - An already-connected {@link LauncherService} instance.
 * @param launcherPort - The launcher's CDP port (needed for port discovery).
 * @returns Per-account result table.
 */
export async function ensureInstances(
  accountIds: number[],
  launcher: LauncherService,
  launcherPort: number,
): Promise<EnsureInstanceResult[]> {
  const results: EnsureInstanceResult[] = [];

  // Entries that started but were not yet verified — checked in parallel
  // in Phase 2 so a slow account doesn't delay faster ones.
  const pendingVerification: Array<{
    accountId: number;
    knownPort: number | undefined;
    resultIdx: number;
  }> = [];

  // -------------------------------------------------------------------------
  // Phase 1: Start accounts sequentially (serialised through launcher queue)
  // -------------------------------------------------------------------------
  for (const accountId of accountIds) {
    // Re-scan before each account so we pick up instances that just came up.
    const running = await scanRunningInstances().catch(() => []);
    const alreadyRunning = running.find(
      (i) => i.accountId === accountId && i.connectable,
    );

    if (alreadyRunning) {
      const entry: EnsureInstanceResult = {
        accountId,
        status: "already_running",
        pid: alreadyRunning.pid,
        verified: true,
      };
      if (alreadyRunning.cdpPort !== null) entry.cdpPort = alreadyRunning.cdpPort;
      results.push(entry);
      continue;
    }

    let outcome: Awaited<ReturnType<typeof startInstanceWithRecovery>>;
    try {
      outcome = await withLauncherQueue(
        () =>
          withLauncherRecovery(
            launcher,
            () => startInstanceWithRecovery(launcher, accountId, launcherPort),
          ).then((r) => r.result),
        { type: "start", accountId, launcherPort },
      );
    } catch (error: unknown) {
      results.push({
        accountId,
        status: "failed",
        error: errorMessage(error),
      });
      continue;
    }

    if (outcome.status === "timeout") {
      results.push({ accountId, status: "timeout" });
      continue;
    }

    const resultIdx = results.length;
    const entry: EnsureInstanceResult = {
      accountId,
      status: outcome.status === "already_running" ? "already_running" : "started",
    };
    if (outcome.port !== undefined) entry.cdpPort = outcome.port;
    if (outcome.pid !== undefined) entry.pid = outcome.pid;
    if (outcome.verified !== undefined) entry.verified = outcome.verified;
    results.push(entry);

    // Queue for parallel Phase 2 verification if not already confirmed.
    if (!outcome.verified) {
      pendingVerification.push({
        accountId,
        knownPort: outcome.port,
        resultIdx,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Phase 2: Verify started accounts in parallel
  //
  // The settle barrier in Phase 1 already waited up to SETTLE_BARRIER_TIMEOUT_MS
  // (~30 s) for each account.  Phase 2 gives remaining time up to the full
  // CONNECTABLE_TIMEOUT_MS (~45 s) from now.  Because we run in parallel,
  // all unverified accounts are checked concurrently — a slow account does not
  // delay reporting of fast ones.
  // -------------------------------------------------------------------------
  if (pendingVerification.length > 0) {
    await Promise.all(
      pendingVerification.map(async ({ accountId, knownPort, resultIdx }) => {
        const waitResult = await waitForConnectable(accountId, {
          ...(knownPort !== undefined ? { knownPort } : {}),
        });
        const entry = results[resultIdx];
        if (entry === undefined) return;
        entry.verified = waitResult.verified;
        if (waitResult.cdpPort !== null) entry.cdpPort = waitResult.cdpPort;
        if (waitResult.pid !== undefined) entry.pid = waitResult.pid;
        // If waitForConnectable timed out with no result, the account truly
        // failed to appear (e.g. unlicensed) — mark as failed.
        if (!waitResult.verified && entry.status === "started") {
          entry.status = "failed";
          entry.error =
            "Instance process never became connectable within the timeout. " +
            "Verify the account has a valid LinkedHelper license.";
        }
      }),
    );
  }

  return results;
}
