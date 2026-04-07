// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { discoverInstancePort, resolveInstancePort } from "../cdp/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { InstanceService } from "../services/instance.js";
import { LauncherService } from "../services/launcher.js";
import { delay } from "../utils/delay.js";
import { isLoopbackAddress } from "../utils/loopback.js";
import { buildCdpOptions, type ConnectionOptions } from "./types.js";

/** Delay (ms) after popup dismissal to let React reconcile before
 *  checking whether force-removed popups reappeared. */
const POPUP_RECONCILIATION_DELAY_MS = 200;

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
  /** Count of non-dismissable popups (launcher-level only; instance
   *  popups are always force-removed and counted under `dismissed`). */
  readonly nonDismissable: number;
}

/**
 * Dismiss error popups in the LinkedHelper UI.
 *
 * Connects to the launcher and instance UI (LinkedIn webview is not
 * required), finds popup close/OK buttons, and clicks them via CDP.
 * Instance popups without buttons are force-removed from the DOM.
 * Returns the number of dismissed vs non-dismissable popups.
 *
 * When the launcher is not available (e.g. connecting directly to an
 * instance), launcher popup dismissal is skipped gracefully.
 */
export async function dismissErrors(
  input: DismissErrorsInput,
): Promise<DismissErrorsOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);

  const cdpOptions = buildCdpOptions(input);

  const accountId = await resolveAccount(cdpPort, cdpOptions);

  let dismissed = 0;
  let nonDismissable = 0;

  // Dismiss launcher popup (best-effort — skipped when connected
  // directly to an instance or launcher is unreachable)
  let connectedToLauncher = false;
  try {
    const launcher = new LauncherService(cdpPort, cdpOptions);
    try {
      await launcher.connect();
      connectedToLauncher = true;
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

  // Dismiss instance UI popups.
  // When connected to a launcher, discover the instance's dynamic CDP
  // port — the launcher port does not host instance UI targets.
  // Discovery only works locally (process inspection), so skip for remote hosts.
  const isLocal = input.cdpHost === undefined || isLoopbackAddress(input.cdpHost);
  const instancePort = connectedToLauncher && isLocal
    ? await discoverInstancePort(cdpPort).catch(() => null)
    : connectedToLauncher ? null : cdpPort;

  if (instancePort !== null) {
    const instance = new InstanceService(instancePort, cdpOptions);
    try {
      await instance.connectUiOnly();
      const result = await instance.dismissInstancePopups();
      dismissed += result.dismissed;
      nonDismissable += result.nonDismissable;

      // Force-removed (non-closable) popups may reappear after React
      // re-renders from cached error state.  Brief pause for any pending
      // reconciliation, then reload the UI page if popups survive.
      if (result.dismissed > 0) {
        await delay(POPUP_RECONCILIATION_DELAY_MS);
        const remaining = await instance.getInstancePopups();
        if (remaining.length > 0) {
          await instance.reloadUI();
        }
      }
    } finally {
      instance.disconnect();
    }
  }

  return { accountId, dismissed, nonDismissable };
}
