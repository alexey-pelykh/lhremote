import { discoverInstancePort } from "../cdp/index.js";
import type { LauncherService } from "./launcher.js";
import { StartInstanceError } from "./errors.js";

/** Maximum time to wait for the instance CDP port to become available (ms). */
const PORT_DISCOVERY_TIMEOUT = 15_000;

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
      await sleep(CRASH_RECOVERY_DELAY);
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
    await sleep(PORT_DISCOVERY_INTERVAL);
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
