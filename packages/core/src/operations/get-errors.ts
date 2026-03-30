// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveAppPort } from "../cdp/index.js";
import type { InstancePopup, UIHealthStatus } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { InstanceService } from "../services/instance.js";
import { LauncherService } from "../services/launcher.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the get-errors operation.
 */
export type GetErrorsInput = ConnectionOptions;

/**
 * Output from the get-errors operation.
 */
export interface GetErrorsOutput extends UIHealthStatus {
  readonly accountId: number;
  /** Popups detected in the instance UI DOM (behind the LinkedIn webview). */
  readonly instancePopups: readonly InstancePopup[];
}

/**
 * Query the current error/dialog/popup state of a LinkedHelper instance.
 *
 * Connects to the launcher, resolves the account, and returns the
 * aggregated UI health status including active instance issues,
 * popup overlay state, and instance UI popups.
 *
 * When the launcher is not available (e.g. connecting directly to an
 * instance), launcher health is reported as healthy and only instance
 * popups are checked.
 *
 * Instance popups are detected on a best-effort basis: if the instance
 * is not running or the UI target is unavailable, the operation still
 * succeeds and returns an empty `instancePopups` array.
 */
export async function getErrors(
  input: GetErrorsInput,
): Promise<GetErrorsOutput> {
  const cdpPort = input.cdpPort ?? await resolveAppPort("instance");

  const cdpOptions = {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  };

  const accountId = await resolveAccount(cdpPort, cdpOptions);

  // Launcher health check (best-effort — returns default healthy
  // status when connected directly to an instance)
  let health: UIHealthStatus = {
    issues: [],
    popup: null,
    instancePopups: [],
    healthy: true,
  };
  try {
    const launcher = new LauncherService(cdpPort, cdpOptions);
    try {
      await launcher.connect();
      health = await launcher.checkUIHealth(accountId);
    } finally {
      launcher.disconnect();
    }
  } catch {
    // Launcher not available — proceed with instance-only health info
  }

  // Best-effort: detect instance UI popups if the UI target is available.
  const instancePopups = await detectInstancePopups(cdpPort, cdpOptions);

  const healthy =
    health.healthy && instancePopups.length === 0;

  return { accountId, ...health, healthy, instancePopups };
}

/**
 * Attempt to detect instance UI popups via {@link InstanceService.connectUiOnly}.
 *
 * Returns an empty array when the UI target is unavailable or the
 * connection fails for any reason.
 */
async function detectInstancePopups(
  cdpPort: number,
  cdpOptions: { host?: string; allowRemote?: boolean },
): Promise<InstancePopup[]> {
  const instance = new InstanceService(cdpPort, cdpOptions);
  try {
    await instance.connectUiOnly();
    return await instance.getInstancePopups();
  } catch {
    return [];
  } finally {
    instance.disconnect();
  }
}
