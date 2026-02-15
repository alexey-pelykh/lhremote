// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe } from "vitest";
import { AppService, type AppServiceOptions } from "../services/app.js";
import { AppNotFoundError } from "../services/errors.js";
import { discoverTargets } from "../cdp/discovery.js";
import { LauncherService } from "../services/launcher.js";
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

  // Phase 2: Wait for full launcher readiness (WebSocket + renderer loaded)
  while (Date.now() < deadline) {
    const launcher = new LauncherService(port);
    try {
      await launcher.connect();
      await launcher.listAccounts();
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
 */
export async function quitApp(app: AppService): Promise<void> {
  try {
    await app.quit();
  } catch {
    // Swallow errors during cleanup
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
