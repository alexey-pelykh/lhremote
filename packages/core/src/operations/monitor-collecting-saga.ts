// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { ServiceError } from "../services/errors.js";
import { InstanceService } from "../services/instance.js";
import type { InstancePopup } from "../types/index.js";
import { delay } from "../utils/delay.js";

/** Default deadline for the monitor (10 min — collect-people typically runs ≤9 min). */
const DEFAULT_TIMEOUT = 600_000;

/** Default poll interval between state probes (5s — collect runs in minutes; sub-second polling is wasteful). */
const DEFAULT_POLL_INTERVAL = 5_000;

/**
 * Patterns matching popups that LH itself recovers from via its internal
 * `CampaignController.ensureCwIsInLoggedInState` retry loop (see research
 * §10).  These pop up briefly during normal saga operation when the
 * LinkedIn ContentWindow drops to `li-logged-in-loading` mid-saga, then
 * disappear after LH re-navigates and the CW returns to `LoggedInState`.
 *
 * We auto-dismiss them between polls so the LH UI stays clean and so
 * E2E `installErrorDetection` doesn't fail on transient noise.  Anything
 * outside this allowlist surfaces in `unrecoverablePopups` for the caller
 * to inspect.
 */
const RECOVERABLE_POPUP_PATTERNS: readonly RegExp[] = [
  /IncorrectContentStateError/i,
  /Incorrect web-page state/i,
  /li-logged-in-loading/i,
];

function isRecoverablePopup(popup: InstancePopup): boolean {
  const text = `${popup.title} ${popup.description ?? ""}`;
  return RECOVERABLE_POPUP_PATTERNS.some((p) => p.test(text));
}

/**
 * Probe script: reads `mw.isCollecting` (and `mw.isPreparingCollecting`)
 * via the `@electron/remote` proxy at `window.mainWindowService.mainWindow`.
 * Verified reachable in `saga-control-spike.e2e.test.ts` (#792 spike).
 *
 * Returns `{ collecting, preparing, error }`. `collecting === false` AND
 * `preparing === false` is the saga-idle signal that ends the monitor.
 */
const IS_COLLECTING_SCRIPT = `(async () => {
  try {
    const mw = window.mainWindowService && window.mainWindowService.mainWindow;
    if (!mw) return { collecting: false, preparing: false, error: 'no-main-window' };
    const collecting = mw.isCollecting === true;
    const preparing = mw.isPreparingCollecting === true;
    return { collecting, preparing };
  } catch (err) {
    return { collecting: false, preparing: false, error: err && err.message ? err.message : String(err) };
  }
})()`;

interface IsCollectingProbeResult {
  readonly collecting: boolean;
  readonly preparing: boolean;
  readonly error?: string;
}

/**
 * Recorded unrecoverable popup, deduplicated by title within a single
 * monitor invocation.
 */
export interface UnrecoverablePopup {
  readonly title: string;
  readonly description?: string;
  /** When this popup was first observed, in ms since monitor start. */
  readonly firstSeenMs: number;
}

export interface MonitorCollectingSagaOptions {
  /** Total deadline in ms (default `600_000` — 10 min). */
  readonly timeout?: number;
  /** Poll interval in ms (default `5_000` — 5s). */
  readonly pollInterval?: number;
  /**
   * If `true`, the monitor returns successfully even when the saga never
   * starts (i.e., `mw.isCollecting` was already `false` at first probe).
   * Default `true` — supports callers that monitor speculatively.
   */
  readonly allowImmediateIdle?: boolean;
}

export interface MonitorCollectingSagaResult {
  /** Total time the monitor ran, in ms. */
  readonly durationMs: number;
  /**
   * Number of distinct polling iterations on which AT LEAST ONE recoverable
   * popup was observed and dismissed.  Each iteration counts as one event
   * regardless of how many popups were dismissed in that iteration.
   */
  readonly recoveryEvents: number;
  /** Total individual popup instances dismissed across the whole monitor run. */
  readonly popupsDismissed: number;
  /** Unrecoverable popups observed during the run, deduplicated by title. */
  readonly unrecoverablePopups: readonly UnrecoverablePopup[];
  /** `true` if the saga reached idle within the timeout. */
  readonly reachedIdle: boolean;
}

/**
 * Thrown when the monitor's poll loop hits the configured deadline before
 * the saga reaches idle.
 */
export class MonitorCollectingSagaTimeoutError extends ServiceError {
  readonly waitedMs: number;
  readonly recoveryEvents: number;
  readonly popupsDismissed: number;
  readonly unrecoverablePopups: readonly UnrecoverablePopup[];

  constructor(
    waitedMs: number,
    recoveryEvents: number,
    popupsDismissed: number,
    unrecoverablePopups: readonly UnrecoverablePopup[],
  ) {
    super(
      `Collecting saga did not reach idle after ${String(waitedMs)}ms ` +
        `(recoveryEvents=${String(recoveryEvents)}, popupsDismissed=${String(popupsDismissed)}, ` +
        `unrecoverablePopups=${String(unrecoverablePopups.length)})`,
    );
    this.name = "MonitorCollectingSagaTimeoutError";
    this.waitedMs = waitedMs;
    this.recoveryEvents = recoveryEvents;
    this.popupsDismissed = popupsDismissed;
    this.unrecoverablePopups = unrecoverablePopups;
  }
}

/**
 * Monitor an in-flight LH-internal collecting saga, dismissing recoverable
 * `IncorrectContentStateError` popups so the LH UI stays clean.
 *
 * **Why this exists**: `mws.callWrite('collect', ...)` is fire-and-forget
 * from lhremote's side — the actual saga runs inside LH's process, where
 * our `withLoggedInStateRetry` gate cannot wrap it.  When LinkedIn
 * re-validates the session mid-saga, LH's `CampaignController` retries via
 * its internal `ensureCwIsInLoggedInState` (research §10), but each retry
 * surfaces a popup in the LH UI.  This monitor dismisses those transient
 * popups while leaving non-recoverable ones (checkpoint challenges,
 * account-locked dialogs, etc.) for the caller to inspect.
 *
 * **What it doesn't do**: it does not pause/resume the saga (LH exposes no
 * such API — verified via `saga-control-spike.e2e.test.ts`).  LH's
 * internal retry handles state degradation; this function just hides the
 * UI noise that retry generates.
 *
 * **When to use**: after firing a long-running fire-and-forget operation
 * like `collectionService.collect(...)` or `campaignStart(...)`, await
 * this function to prevent LH UI from filling up with retry popups.
 *
 * The poll loop:
 *   1. Probes `mw.isCollecting` AND `mw.isPreparingCollecting` via the
 *      `@electron/remote` proxy at `window.mainWindowService.mainWindow`.
 *   2. While either is `true`, reads the popup list:
 *        - Categorises each popup as recoverable (IncorrectContentStateError
 *          family) or unrecoverable (everything else).
 *        - **Dismisses ONLY when every visible popup is recoverable.**  When
 *          ANY unrecoverable popup is present (e.g., account locked,
 *          checkpoint challenge), no dismissal happens and the popups stay
 *          visible for the user to act on.  This preserves visibility of
 *          critical issues at the cost of leaving recoverable noise on
 *          screen until the unrecoverable issue is resolved.
 *        - Records unrecoverable popups in `result.unrecoverablePopups`,
 *          deduplicated by title — every distinct unrecoverable title is
 *          recorded once, regardless of how many polls observe it.
 *   3. When both `isCollecting` and `isPreparingCollecting` flip to
 *      `false`, returns successfully.
 *   4. If the deadline is reached first, throws
 *      {@link MonitorCollectingSagaTimeoutError}.
 *
 * @throws {MonitorCollectingSagaTimeoutError} when the saga does not reach
 *   idle within {@link MonitorCollectingSagaOptions.timeout}.
 */
export async function monitorCollectingSaga(
  instance: InstanceService,
  opts: MonitorCollectingSagaOptions = {},
): Promise<MonitorCollectingSagaResult> {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const pollInterval = opts.pollInterval ?? DEFAULT_POLL_INTERVAL;
  const allowImmediateIdle = opts.allowImmediateIdle ?? true;
  const start = Date.now();
  const deadline = start + timeout;

  let recoveryEvents = 0;
  let popupsDismissed = 0;
  const unrecoverablePopups: UnrecoverablePopup[] = [];
  const seenUnrecoverableTitles = new Set<string>();
  let everSawCollecting = false;

  while (Date.now() < deadline) {
    const probe = await instance.evaluateUI<IsCollectingProbeResult>(
      IS_COLLECTING_SCRIPT,
    );

    // A probe error (e.g., `no-main-window`, transient CDP failure) is NOT
    // an "idle" signal — it's "unknown".  Returning reachedIdle on a failed
    // probe would mask a stuck monitor against an unhealthy LH process.
    // Skip the active/idle classification, keep polling until the next
    // probe either succeeds or the deadline expires.
    if (probe.error === undefined) {
      const sagaActive = probe.collecting || probe.preparing;
      if (sagaActive) {
        everSawCollecting = true;
      } else if (everSawCollecting || allowImmediateIdle) {
        return {
          durationMs: Date.now() - start,
          recoveryEvents,
          popupsDismissed,
          unrecoverablePopups,
          reachedIdle: true,
        };
      }
    }

    const popups = await instance.getInstancePopups();
    if (popups.length > 0) {
      let sawRecoverable = false;
      let sawUnrecoverable = false;
      for (const popup of popups) {
        if (isRecoverablePopup(popup)) {
          sawRecoverable = true;
        } else {
          sawUnrecoverable = true;
          if (!seenUnrecoverableTitles.has(popup.title)) {
            seenUnrecoverableTitles.add(popup.title);
            unrecoverablePopups.push({
              title: popup.title,
              ...(popup.description !== undefined && {
                description: popup.description,
              }),
              firstSeenMs: Date.now() - start,
            });
          }
        }
      }

      if (sawRecoverable && !sawUnrecoverable) {
        const dismissResult = await instance.dismissInstancePopups();
        popupsDismissed += dismissResult.dismissed;
        recoveryEvents++;
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(pollInterval, remaining));
  }

  throw new MonitorCollectingSagaTimeoutError(
    Date.now() - start,
    recoveryEvents,
    popupsDismissed,
    unrecoverablePopups,
  );
}
