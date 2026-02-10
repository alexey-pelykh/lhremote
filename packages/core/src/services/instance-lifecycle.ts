import { discoverInstancePort } from "../cdp/index.js";
import { delay } from "../utils/delay.js";
import type { LauncherService } from "./launcher.js";
import { StartInstanceError } from "./errors.js";

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
        return { status: "already_running", port: existingPort };
      }

      // Stale state — crash recovery
      await launcher.stopInstance(accountId);
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
