// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { CDPConnectionError, discoverInstancePort, discoverTargets } from "../cdp/index.js";
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
 */
export type StartInstanceOutcome =
  | { status: "started"; port: number }
  | { status: "already_running"; port: number }
  | { status: "timeout" };

/**
 * Start a LinkedHelper instance with idempotent handling and crash recovery.
 *
 * - If the instance is already running and reachable, returns `already_running`.
 * - If the launcher reports "already running" but the port is not discoverable
 *   (stale state after crash), performs crash recovery: stop → delay → restart.
 * - After starting, polls for the instance CDP port until available or timeout.
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
        return { status: "already_running", port: existingPort };
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
  return { status: "started", port };
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
