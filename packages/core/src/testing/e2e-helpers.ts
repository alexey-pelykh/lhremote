// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect } from "vitest";
import { AppService, type AppServiceOptions } from "../services/app.js";
import { AppNotFoundError } from "../services/errors.js";
import { discoverTargets } from "../cdp/discovery.js";
import { killInstanceProcesses } from "../cdp/instance-discovery.js";
import { getErrors } from "../operations/get-errors.js";
import { LauncherService } from "../services/launcher.js";
import { waitForInstanceShutdown } from "../services/instance-lifecycle.js";
import type { Account } from "../types/index.js";
import { delay } from "../utils/delay.js";

const linkedHelperAvailable = (() => {
  try {
    AppService.findBinary();
    return true;
  } catch (error) {
    if (error instanceof AppNotFoundError) {
      return false;
    }
    throw error;
  }
})();

/**
 * Wrapper around `describe.skipIf` that skips the suite when
 * the LinkedHelper binary is not installed.
 */
export function describeE2E(
  name: string,
  fn: () => void,
): ReturnType<typeof describe> {
  return describe.skipIf(!linkedHelperAvailable)(`${name} (e2e)`, fn);
}

export interface LaunchedApp {
  app: AppService;
  port: number;
}

/**
 * Launch LinkedHelper and wait for the launcher to become fully ready.
 *
 * Readiness is verified in two phases:
 * 1. The CDP HTTP endpoint (`/json/list`) returns at least one target.
 * 2. A full `LauncherService` connection succeeds and can query accounts,
 *    confirming the Electron renderer, `@electron/remote`, and the
 *    electron-store are all operational.
 *
 * @param options.timeout Maximum ms to wait for full readiness (default 30 000).
 */
export async function launchApp(options?: {
  timeout?: number;
  appOptions?: AppServiceOptions;
}): Promise<LaunchedApp> {
  const timeout = options?.timeout ?? 30_000;
  const app = new AppService(undefined, options?.appOptions);

  await app.launch();

  const port = app.cdpPort;
  const deadline = Date.now() + timeout;

  // Phase 1: Wait for CDP HTTP endpoint to expose targets
  while (Date.now() < deadline) {
    try {
      const targets = await discoverTargets(port);
      if (targets.length > 0) break;
    } catch {
      // Not ready yet
    }
    await delay(250);
  }

  // Phase 2: Wait for full launcher readiness (WebSocket + renderer loaded).
  // We only verify that LauncherService.connect() succeeds (which validates
  // electronStore access).  listAccounts() has its own internal cache
  // polling, so calling it here would double the timeout budget.
  while (Date.now() < deadline) {
    const launcher = new LauncherService(port);
    try {
      await launcher.connect();
      launcher.disconnect();
      return { app, port };
    } catch {
      launcher.disconnect();
    }
    await delay(500);
  }

  // Clean up on timeout
  try {
    await app.quit();
  } catch {
    // ignore
  }

  throw new Error(
    `LinkedHelper launcher did not become fully ready on port ${String(port)} within ${String(timeout)}ms`,
  );
}

/**
 * Quit LinkedHelper, swallowing errors for cleanup use.
 *
 * When {@link port} is provided, dismisses the "All instances will be
 * closed" launcher popup concurrently with the quit signal so the
 * process can exit cleanly instead of stalling on the dialog.
 */
export async function quitApp(app: AppService, port?: number): Promise<void> {
  try {
    if (port !== undefined) {
      await Promise.all([
        app.quit(),
        dismissLauncherPopupDuringQuit(port),
      ]);
    } else {
      await app.quit();
    }
  } catch {
    // Swallow errors during cleanup
  }
}

/**
 * Poll for and dismiss the launcher popup that appears when quitting
 * while instances are still running.  Best-effort — returns silently
 * on any error (the launcher may already be gone).
 */
async function dismissLauncherPopupDuringQuit(port: number): Promise<void> {
  const CONNECT_TIMEOUT = 5_000;
  const launcher = new LauncherService(port);
  try {
    const connected = await Promise.race([
      launcher.connect().then(() => true as const),
      delay(CONNECT_TIMEOUT).then(() => false as const),
    ]);
    if (!connected) return;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const dismissed = await launcher.dismissPopup();
        if (dismissed) return;
      } catch {
        return;
      }
      await delay(500);
    }
  } catch {
    // Best effort — launcher may not be reachable
  } finally {
    launcher.disconnect();
  }
}

/**
 * Retry an async operation with configurable attempts and delay.
 *
 * Useful in E2E tests where CDP endpoints may be transiently
 * unavailable during the LinkedHelper app lifecycle.
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options?: { retries?: number; delay?: number },
): Promise<T> {
  const retries = options?.retries ?? 3;
  const interval = options?.delay ?? 500;
  let lastError: unknown;

  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < retries) {
        await delay(interval);
      }
    }
  }

  throw lastError;
}

/** Type-narrowing assertion — fails the test with `message` when `value` is nullish. */
export function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  expect(value, message).toBeDefined();
  expect(value, message).not.toBeNull();
}

/**
 * Person ID for E2E tests that interact with a specific LinkedIn person.
 * Read from `LHREMOTE_E2E_PERSON_ID` — must be a positive integer.
 */
export function getE2EPersonId(): number {
  const raw = process.env.LHREMOTE_E2E_PERSON_ID;
  if (!raw) throw new Error("LHREMOTE_E2E_PERSON_ID must be set");
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("LHREMOTE_E2E_PERSON_ID must be a positive integer");
  }
  return id;
}

/**
 * Read the `LHREMOTE_E2E_POST_URL` environment variable.
 *
 * Returns a LinkedIn post URL used for post-based E2E tests
 * (react-to-post, comment-on-post).
 *
 * @throws if `LHREMOTE_E2E_POST_URL` is not set or is empty.
 */
export function getE2EPostUrl(): string {
  const url = process.env.LHREMOTE_E2E_POST_URL;
  if (!url) throw new Error("LHREMOTE_E2E_POST_URL must be set");
  return url;
}

/**
 * Connect to the launcher, list accounts, and return the first account ID.
 *
 * Fails the test if no accounts are configured in LinkedHelper.
 */
export async function resolveAccountId(port: number): Promise<number> {
  const launcher = new LauncherService(port);
  await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
  try {
    const accounts = await launcher.listAccounts();
    if (accounts.length === 0) {
      throw new Error("No accounts configured in LinkedHelper");
    }
    return (accounts[0] as Account).id;
  } finally {
    launcher.disconnect();
  }
}

/**
 * Stop the instance gracefully, falling back to SIGKILL if that fails.
 */
export async function forceStopInstance(
  launcher: LauncherService,
  accountId: number | undefined,
  launcherPort: number,
): Promise<void> {
  if (accountId === undefined) return;

  try {
    await launcher.stopInstanceWithDialogDismissal(accountId);
    await waitForInstanceShutdown(launcherPort);
    return;
  } catch {
    // Graceful stop failed — escalate to OS kill
  }

  await killInstanceProcesses(launcherPort);
}

/**
 * Install `beforeEach`/`afterEach` hooks that fail a test when it
 * introduces new LinkedHelper errors (issues or instance popups).
 *
 * Call once inside a `describe` block that runs against a live
 * LinkedHelper instance.  The {@link getCdpPort} callback is evaluated
 * lazily so the port can be assigned in `beforeAll`.
 *
 * Error detection is best-effort: if {@link getErrors} itself fails
 * (e.g. instance not reachable), the hooks silently skip the check
 * rather than failing the test.
 */
export function installErrorDetection(getCdpPort: () => number): void {
  let issueCountBefore = 0;
  let popupCountBefore = 0;

  beforeEach(async () => {
    try {
      const result = await getErrors({ cdpPort: getCdpPort() });
      issueCountBefore = result.issues.length;
      popupCountBefore = result.instancePopups.length;
    } catch {
      issueCountBefore = 0;
      popupCountBefore = 0;
    }
  });

  afterEach(async () => {
    let result;
    try {
      result = await getErrors({ cdpPort: getCdpPort() });
    } catch {
      // Swallow connectivity errors — don't fail tests because of the check itself
      return;
    }
    const newIssues = result.issues.slice(issueCountBefore);
    const newPopups = result.instancePopups.slice(popupCountBefore);
    const newErrors = [...newIssues, ...newPopups];
    expect(
      newErrors,
      `LH logged ${String(newErrors.length)} error(s) during test: ${JSON.stringify(newErrors)}`,
    ).toHaveLength(0);
  });
}
