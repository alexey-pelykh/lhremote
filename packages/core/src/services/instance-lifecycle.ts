// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { CDPConnectionError, discoverInstancePort, discoverTargets, invalidateProcessCache, scanRunningInstances } from "../cdp/index.js";
import type { CdpTarget } from "../types/cdp.js";
import { delay } from "../utils/delay.js";
import { StartInstanceError } from "./errors.js";
import { InstanceService } from "./instance.js";
import type { LauncherService } from "./launcher.js";

/**
 * Maximum time to wait for the instance CDP port to become available (ms).
 *
 * LinkedHelper instances are full Electron apps that load LinkedIn on startup,
 * so the CDP endpoint may not be ready for 30+ seconds after the process starts.
 */
const PORT_DISCOVERY_TIMEOUT = 45_000;

/** Maximum time to wait for the instance CDP port to disappear after stop (ms). */
const PORT_SHUTDOWN_TIMEOUT = 15_000;

/** Interval between port discovery attempts (ms). */
const PORT_DISCOVERY_INTERVAL = 1_000;

/**
 * Maximum time to wait for both CDP targets (LinkedIn webview + UI) to appear (ms).
 *
 * After the CDP port is available, the instance still needs time to create
 * both the LinkedIn webview and the UI target. This timeout mirrors
 * {@link InstanceService.connect}'s `CONNECT_TIMEOUT`.
 */
const TARGET_DISCOVERY_TIMEOUT = 30_000;

/** Interval between target discovery attempts (ms). */
const TARGET_DISCOVERY_INTERVAL = 1_000;

/** Delay after crash recovery stop before retrying start (ms). */
const CRASH_RECOVERY_DELAY = 2_000;

/**
 * Result of a start-instance operation.
 *
 * The `pid` and `verified` fields are populated by post-start process
 * inspection (F4).  `verified: true` means the new process's `--app-id`
 * matches the requested account AND it is connectable on a distinct port.
 * `verified: false` means verification failed (phantom/duplicate port).
 * `verified: undefined` means verification was not attempted (e.g. on
 * `"already_running"` paths where the port was already live).
 */
export type StartInstanceOutcome =
  | { status: "started"; port: number; pid?: number; verified?: boolean }
  | { status: "already_running"; port: number; pid?: number; verified?: boolean }
  | { status: "timeout" };

/**
 * Start a LinkedHelper instance with idempotent handling, crash recovery,
 * and post-start verification (F4).
 *
 * - If the instance is already running and reachable, returns `already_running`.
 * - If the launcher reports "already running" but the port is not discoverable
 *   (stale state after crash), performs crash recovery: stop → delay → restart.
 * - After starting, polls for the instance CDP port until available or timeout.
 * - Post-start verification confirms the new process's `--app-id` matches
 *   `accountId` and it is connectable on a distinct port.  Sets `verified` on
 *   the outcome; a duplicate/phantom port surfaces as `verified: false`.
 */
export async function startInstanceWithRecovery(
  launcher: LauncherService,
  accountId: number,
  launcherPort: number,
): Promise<StartInstanceOutcome> {
  try {
    await launcher.startInstance(accountId);
  } catch (error) {
    if (
      error instanceof StartInstanceError &&
      error.message.includes("already running")
    ) {
      const existingPort = await discoverInstancePort(launcherPort);
      if (existingPort !== null) {
        const targetsReady = await waitForInstanceTargets(existingPort);
        if (!targetsReady) {
          await checkForStartupPopups(existingPort, accountId);
          return { status: "timeout" };
        }
        await checkForStartupPopups(existingPort, accountId);
        // Verify the already-running instance matches this account
        const alreadyVerification = await verifyInstanceStarted(accountId, existingPort);
        return {
          status: "already_running",
          port: existingPort,
          verified: alreadyVerification.verified,
          ...(alreadyVerification.pid !== undefined ? { pid: alreadyVerification.pid } : {}),
        };
      }

      // Stale state — crash recovery
      await launcher.stopInstanceWithDialogDismissal(accountId);
      await delay(CRASH_RECOVERY_DELAY);
      await launcher.startInstance(accountId);
    } else {
      throw error;
    }
  }

  const port = await waitForInstancePort(launcherPort);
  if (port === null) {
    return { status: "timeout" };
  }

  const targetsReady = await waitForInstanceTargets(port);
  if (!targetsReady) {
    // Check for popups before returning a generic timeout — an error popup
    // is more actionable than "failed to initialize within timeout".
    await checkForStartupPopups(port, accountId);
    return { status: "timeout" };
  }

  await checkForStartupPopups(port, accountId);

  // Post-start verification: confirm the new process matches the requested account
  const startVerification = await verifyInstanceStarted(accountId, port);
  return {
    status: "started",
    port,
    verified: startVerification.verified,
    ...(startVerification.pid !== undefined ? { pid: startVerification.pid } : {}),
  };
}

/**
 * Verify that a started instance belongs to `accountId` and is connectable.
 *
 * Scans running instances via process inspection and looks for an entry
 * whose `accountId` matches and whose `cdpPort` equals `expectedPort`.
 * A mismatch (duplicate port, wrong account) sets `verified: false`.
 */
async function verifyInstanceStarted(
  accountId: number,
  expectedPort: number,
): Promise<{ pid: number | undefined; verified: boolean }> {
  try {
    const instances = await scanRunningInstances();
    const match = instances.find(
      (i) =>
        i.accountId === accountId &&
        i.connectable &&
        i.cdpPort === expectedPort,
    );
    if (match) {
      return { pid: match.pid, verified: true };
    }
    // Phantom/duplicate port: port reported but no matching account process found
    return { pid: undefined, verified: false };
  } catch {
    // Verification is best-effort; don't block the start outcome
    return { pid: undefined, verified: false };
  }
}

/**
 * Poll for the instance CDP port until available or timeout.
 *
 * The underlying `discoverInstancePort` verifies each candidate port
 * responds to the CDP `/json/list` endpoint, so the returned port is
 * guaranteed to be a working CDP port.
 */
export async function waitForInstancePort(
  launcherPort: number,
): Promise<number | null> {
  const deadline = Date.now() + PORT_DISCOVERY_TIMEOUT;

  while (Date.now() < deadline) {
    const port = await discoverInstancePort(launcherPort);
    if (port !== null) {
      return port;
    }
    await delay(PORT_DISCOVERY_INTERVAL);
  }

  return null;
}

/**
 * Poll until no instance CDP port is discoverable, or timeout.
 *
 * Use after `stopInstance()` to ensure the process has fully exited
 * before starting a new instance.
 */
export async function waitForInstanceShutdown(
  launcherPort: number,
): Promise<void> {
  const deadline = Date.now() + PORT_SHUTDOWN_TIMEOUT;

  while (Date.now() < deadline) {
    const port = await discoverInstancePort(launcherPort);
    if (port === null) {
      return;
    }
    await delay(PORT_DISCOVERY_INTERVAL);
  }
}

/** Maximum time to wait for a PID to exit after a stop call (ms). */
const PID_EXIT_TIMEOUT = 15_000;

/** Interval between PID-existence checks while waiting for exit (ms). */
const PID_EXIT_INTERVAL = 500;

/**
 * Check whether a process with the given PID is still running.
 *
 * Uses signal 0 which does not terminate the process — it only probes
 * existence.  Returns `false` when the process has exited (`ESRCH`).
 * Returns `true` on `EPERM` (process exists, no permission to signal) or any
 * other error (conservative: assume process is still alive).
 */
function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Poll until the process with `pid` has exited, or `timeoutMs` elapses.
 *
 * Invalidates the process-inspection cache before each check so polling
 * reflects the true process state rather than cached data.
 *
 * Used by `restart-instance` to confirm the old process is gone before
 * starting a new one on the same account slot.
 */
export async function waitForPidExit(
  pid: number,
  timeoutMs = PID_EXIT_TIMEOUT,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    invalidateProcessCache();
    if (!pidExists(pid)) return;
    await delay(PID_EXIT_INTERVAL);
  }
}

/**
 * Poll until both CDP targets (LinkedIn webview and instance UI) are
 * discoverable on the given port, or timeout.
 *
 * The CDP port may respond to `/json/list` before the instance has
 * created both targets.  This function bridges the gap between
 * "process is alive" and "instance is fully initialized".
 */
export async function waitForInstanceTargets(
  port: number,
): Promise<boolean> {
  const deadline = Date.now() + TARGET_DISCOVERY_TIMEOUT;

  while (Date.now() < deadline) {
    try {
      const targets = await discoverTargets(port);
      const hasLinkedIn = targets.some(isLinkedInTarget);
      const hasUI = targets.some(isUiTarget);
      if (hasLinkedIn && hasUI) {
        return true;
      }
    } catch (error) {
      if (!(error instanceof CDPConnectionError)) {
        throw error;
      }
      // CDP endpoint not ready yet — retry
    }
    await delay(TARGET_DISCOVERY_INTERVAL);
  }

  return false;
}

function isLinkedInTarget(target: CdpTarget): boolean {
  return target.type === "page" && target.url.includes("linkedin.com");
}

function isUiTarget(target: CdpTarget): boolean {
  return target.type === "page" && target.url.includes("index.html");
}

/**
 * Connect to the instance UI and check for error popups.
 *
 * Throws {@link StartInstanceError} if any popups are detected.
 * Silently returns if the popup check itself fails (best-effort).
 */
async function checkForStartupPopups(
  port: number,
  accountId: number,
): Promise<void> {
  const instance = new InstanceService(port);
  try {
    await instance.connectUiOnly();
    const popups = await instance.getInstancePopups();
    if (popups.length > 0) {
      const details = popups
        .map(
          (p) =>
            `${p.title}${p.description ? ` — ${p.description}` : ""}`,
        )
        .join("; ");
      throw new StartInstanceError(
        accountId,
        `instance has error popups: ${details}`,
      );
    }
  } catch (error) {
    if (error instanceof StartInstanceError) {
      throw error;
    }
    // Popup check is best-effort; silently skip if the check itself fails
  } finally {
    instance.disconnect();
  }
}
