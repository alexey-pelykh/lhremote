// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { ServiceError } from "../services/errors.js";
import { InstanceService } from "../services/instance.js";
import { delay } from "../utils/delay.js";

/**
 * Default deadline for the gate (60s).  Long enough to cover a typical
 * LinkedIn `/me` re-validation round-trip after a session refresh, short
 * enough that callers don't sit indefinitely on a stuck instance.
 */
const DEFAULT_TIMEOUT = 60_000;

/** Default poll interval between DOM probes (500ms — same cadence the LH frontend uses). */
const DEFAULT_POLL_INTERVAL = 500;

/**
 * URL pathname prefixes that LinkedHelper's `LoggedInState.canEnter()`
 * accepts as logged-in pages.  Mirrors the set extracted from
 * `dist/ContentWindow/States/LinkedIn/BaseState/LoggedInState/impl/canEnter.jsc`
 * (research/linkedhelper/state/li-window-state-machine-20260506.md §6).
 *
 * `/feed` is included implicitly as the default LinkedIn root.
 */
const LOGGED_IN_PATH_PREFIXES = [
  "/feed",
  "/in/",
  "/mynetwork",
  "/search",
  "/messaging",
  "/groups",
  "/company",
  "/posts",
  "/events",
];

/**
 * Thrown when the LinkedIn ContentWindow does not enter `LoggedInState`
 * within the configured deadline.  Almost always indicates LinkedIn is
 * re-validating the session (fresh `/me` API call in flight) or the
 * instance has dropped to a security-checkpoint page.
 */
export class LoggedInStateTimeoutError extends ServiceError {
  readonly waitedMs: number;
  readonly lastReason: string;

  constructor(waitedMs: number, lastReason: string) {
    super(
      `Timed out after ${String(waitedMs)}ms waiting for LinkedIn ContentWindow to enter LoggedInState ` +
        `(last reason: ${lastReason})`,
    );
    this.name = "LoggedInStateTimeoutError";
    this.waitedMs = waitedMs;
    this.lastReason = lastReason;
  }
}

/**
 * Result shape returned by the in-page DOM probe.  `ok` is true only when
 * the LinkedIn React/SDUI nav avatar has rendered, which is a reliable
 * proxy for `meRawData.isSuccessful` — the canonical entry condition for
 * `LoggedInState`.
 *
 * Verified live via `state-spike.e2e.test.ts` against LH 2.113.62 on
 * `/feed/` (2026-05-06 — see research/linkedhelper/state/li-window-state-machine-20260506.md
 * §11.1 and the spike's `dom-heuristic` recording).
 */
interface ProbeResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly hostname?: string;
  readonly pathname?: string;
}

/**
 * In-page predicate.  Mirrors LH's `LoggedInState.canEnter()` via DOM
 * heuristics on the LinkedIn target — IPC-channel access to
 * `liWindow.checkIfInLoggedInState` is not exposed on the launcher-side
 * `mws` dispatcher (rejected as `wrong method names for callRead` and
 * `this.mainWindow[Q] is not a function`; see #781 spike).
 *
 * The "me-rendered" signal is the global-nav avatar
 * (`img[alt][src*="profile-displayphoto-shrink"]`) — only painted once
 * the IMiniProfile React store has hydrated, which is exactly the
 * `LoggedInState` entry condition.
 */
const PROBE_SCRIPT = `(() => {
  if (location.hostname !== 'www.linkedin.com') {
    return { ok: false, reason: 'wrong-host', hostname: location.hostname, pathname: location.pathname };
  }
  const PATHS = ${JSON.stringify(LOGGED_IN_PATH_PREFIXES)};
  if (!PATHS.some(p => location.pathname.startsWith(p))) {
    return { ok: false, reason: 'wrong-path', hostname: location.hostname, pathname: location.pathname };
  }
  const me = document.querySelector('img[alt][src*="profile-displayphoto-shrink"]');
  if (!me) {
    return { ok: false, reason: 'me-not-rendered', hostname: location.hostname, pathname: location.pathname };
  }
  return { ok: true, hostname: location.hostname, pathname: location.pathname };
})()`;

export interface WaitForLoggedInStateOptions {
  /** Deadline in ms (default `60_000`). */
  readonly timeout?: number;
  /** Poll interval between DOM probes in ms (default `500`). */
  readonly pollInterval?: number;
  /**
   * Whether to require the `LoggedInState` finality flag.  Currently
   * unused by the DOM heuristic — kept for API parity with LH's
   * `checkIfInLoggedInState(isFinal)` so callers and the future IPC
   * implementation agree on the signature.  Default `true`.
   */
  readonly isFinal?: boolean;
}

/**
 * Wait until the LinkedIn ContentWindow is in `LoggedInState` (the LH
 * predicate that gates every action).  Polls the LinkedIn target's DOM
 * every {@link WaitForLoggedInStateOptions.pollInterval | pollInterval} ms
 * and resolves as soon as the in-page heuristic returns `ok: true`.
 *
 * Use this as a pre-flight gate at the start of every long-running
 * operation (`collect-people`, `comment-on-post`, …) so a brief LinkedIn
 * `/me` re-validation does not surface as
 * `Action.IncorrectContentStateError` to the caller.
 *
 * @throws {LoggedInStateTimeoutError} if the heuristic does not report
 *   `ok: true` before the deadline.
 */
export async function waitForLoggedInState(
  instance: InstanceService,
  opts: WaitForLoggedInStateOptions = {},
): Promise<void> {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const pollInterval = opts.pollInterval ?? DEFAULT_POLL_INTERVAL;
  const start = Date.now();
  const deadline = start + timeout;

  let lastReason = "no-probe-yet";
  while (Date.now() < deadline) {
    let probe: ProbeResult;
    try {
      probe = await instance.evaluateLinkedIn<ProbeResult>(PROBE_SCRIPT, false);
    } catch (err) {
      lastReason = `probe-threw: ${err instanceof Error ? err.message : String(err)}`;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(pollInterval, remaining));
      continue;
    }

    if (probe.ok) return;
    lastReason = probe.reason ?? "unknown";

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(pollInterval, remaining));
  }

  throw new LoggedInStateTimeoutError(Date.now() - start, lastReason);
}

/**
 * Convenience wrapper for operations that drive the LinkedIn webview via
 * a raw {@link CDPClient} and don't already have an
 * {@link InstanceService} in scope (`comment-on-post`, `react-to-post`,
 * `unfollow-from-feed`, etc.).
 *
 * Opens a temporary `InstanceService`, runs the gate, then disconnects.
 * Operations that already construct an `InstanceService` (via
 * `withInstanceDatabase`) should call {@link waitForLoggedInState}
 * directly instead of routing through this wrapper.
 */
export async function gateOnLoggedInState(
  cdpPort: number,
  cdpHost: string,
  allowRemote: boolean,
  opts: WaitForLoggedInStateOptions = {},
): Promise<void> {
  const instance = new InstanceService(cdpPort, { host: cdpHost, allowRemote });
  await instance.connect();
  try {
    await waitForLoggedInState(instance, opts);
  } finally {
    instance.disconnect();
  }
}
