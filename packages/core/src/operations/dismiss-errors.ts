// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveAppPort } from "../cdp/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { InstanceService } from "../services/instance.js";
import { LauncherService } from "../services/launcher.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the dismiss-errors operation.
 */
export type DismissErrorsInput = ConnectionOptions;

/**
 * Output from the dismiss-errors operation.
 */
export interface DismissErrorsOutput {
  readonly accountId: number;
  readonly dismissed: number;
  readonly nonDismissable: number;
}

/**
 * Dismiss closable error popups in the LinkedHelper instance UI.
 *
 * Connects to the launcher and instance UI (LinkedIn webview is not
 * required), finds popup close/OK buttons, and clicks them via CDP.
 * Returns the number of dismissed vs non-dismissable popups.
 *
 * When the launcher is not available (e.g. connecting directly to an
 * instance), launcher popup dismissal is skipped gracefully.
 */
export async function dismissErrors(
  input: DismissErrorsInput,
): Promise<DismissErrorsOutput> {
  const cdpPort = input.cdpPort ?? await resolveAppPort("instance");

  const cdpOptions = {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  };

  const accountId = await resolveAccount(cdpPort, cdpOptions);

  let dismissed = 0;
  let nonDismissable = 0;

  // Dismiss launcher popup (best-effort — skipped when connected
  // directly to an instance or launcher is unreachable)
  try {
    const launcher = new LauncherService(cdpPort, cdpOptions);
    try {
      await launcher.connect();
      const popupDismissed = await launcher.dismissPopup();
      if (popupDismissed) {
        dismissed++;
      } else {
        // Check if there's a non-dismissable popup
        const popupState = await launcher.getPopupState();
        if (popupState !== null && popupState.blocked) {
          nonDismissable++;
        }
      }
    } finally {
      launcher.disconnect();
    }
  } catch {
    // Launcher not available at this port — skip launcher popup dismissal
  }

  // Dismiss instance UI popups
  const instance = new InstanceService(cdpPort, cdpOptions);
  try {
    await instance.connectUiOnly();
    const result = await instance.dismissInstancePopups();
    dismissed += result.dismissed;
    nonDismissable += result.nonDismissable;
  } finally {
    instance.disconnect();
  }

  return { accountId, dismissed, nonDismissable };
}
