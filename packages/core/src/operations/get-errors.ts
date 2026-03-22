// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { InstancePopup, UIHealthStatus } from "../types/index.js";
import { discoverTargets } from "../cdp/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { InstanceService } from "../services/instance.js";
import { LauncherService } from "../services/launcher.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
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
 * Instance popups are detected on a best-effort basis: if the instance
 * is not running or the UI target is unavailable, the operation still
 * succeeds and returns an empty `instancePopups` array.
 */
export async function getErrors(
  input: GetErrorsInput,
): Promise<GetErrorsOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const cdpOptions = {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  };

  const accountId = await resolveAccount(cdpPort, cdpOptions);

  const launcher = new LauncherService(cdpPort, cdpOptions);
  let health: UIHealthStatus;
  try {
    await launcher.connect();
    health = await launcher.checkUIHealth(accountId);
  } finally {
    launcher.disconnect();
  }

  // Best-effort: detect instance UI popups if the instance is running.
  const instancePopups = await detectInstancePopups(
    cdpPort,
    input.cdpHost,
    cdpOptions,
  );

  const healthy =
    health.healthy && instancePopups.length === 0;

  return { accountId, ...health, healthy, instancePopups };
}

/**
 * Attempt to detect instance UI popups via a one-shot target discovery.
 *
 * Returns an empty array when the instance is not running or the
 * targets disappear between discovery and connection.
 */
async function detectInstancePopups(
  cdpPort: number,
  cdpHost: string | undefined,
  cdpOptions: { host?: string; allowRemote?: boolean },
): Promise<InstancePopup[]> {
  try {
    const targets = await discoverTargets(cdpPort, cdpHost ?? "127.0.0.1");
    const hasLinkedIn = targets.some(
      (t) => t.type === "page" && t.url.includes("linkedin.com"),
    );
    const hasUI = targets.some(
      (t) => t.type === "page" && t.url.includes("index.html"),
    );
    if (!hasLinkedIn || !hasUI) {
      return [];
    }

    const instance = new InstanceService(cdpPort, cdpOptions);
    try {
      await instance.connect();
      return await instance.getInstancePopups();
    } finally {
      instance.disconnect();
    }
  } catch {
    return [];
  }
}
