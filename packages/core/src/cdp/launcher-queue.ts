// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * In-process async mutex for serializing launcher-touching operations (T1).
 *
 * All write/lifecycle operations — start-instance, stop-instance,
 * restart-instance, launch-app, quit-app, and each internal start within
 * ensure-instances — MUST pass through {@link withLauncherQueue} so that at
 * most one executes at a time.
 *
 * Reads (find-app, check-status, query-*) are launcher-independent and must
 * NOT enter this queue — they remain non-blocking.
 *
 * After each operation, an optional settle barrier delays release of the
 * queue until (a) the launcher CDP is reachable again and (b) the target
 * instance has reached its expected state.  This converts rapid back-to-back
 * starts (the empirically observed cause of launcher CDP drops) into a stable
 * serialised sequence: op → settle → op.
 *
 * Default timings (all configurable via env):
 *   LHREMOTE_SETTLE_BARRIER_TIMEOUT_MS   30 000 — derived from the observed
 *                                                   ~30 s launcher-recovery window
 */

import { resolveAppPort } from "./app-discovery.js";
import { invalidateProcessCache } from "./gather-raw-processes.js";
import { waitForConnectable } from "./instance-readiness.js";

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export const DEFAULT_SETTLE_BARRIER_TIMEOUT_MS = 30_000;

function getSettleTimeoutMs(): number {
  const v = process.env["LHREMOTE_SETTLE_BARRIER_TIMEOUT_MS"];
  return v ? Number(v) : DEFAULT_SETTLE_BARRIER_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Queue state
// ---------------------------------------------------------------------------

/** Tail of the promise chain — the queue head blocks on this. */
let _queueTail: Promise<void> = Promise.resolve();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * What to wait for in the settle barrier after an operation.
 *
 * - `"none"`:     no settling (default)
 * - `"launcher"`: wait for the launcher CDP to be reachable again
 * - `"start"`:    launcher reachable + target account connectable
 * - `"stop"`:     launcher reachable only (instance is no longer expected)
 */
export type SettleType = "none" | "launcher" | "start" | "stop";

/** Options for the settle barrier run after a queued operation. */
export interface LauncherQueueSettleOptions {
  type: SettleType;
  /**
   * Launcher CDP port used for launcher-reachability settling.
   * When omitted, the settle barrier re-discovers it via process inspection.
   */
  launcherPort?: number;
  /** Account ID to wait for when `type === "start"`. */
  accountId?: number;
  /** Known CDP port from the start outcome — enables cheap re-probing. */
  knownPort?: number;
  /**
   * Override settle barrier budget in ms.
   * Default: LHREMOTE_SETTLE_BARRIER_TIMEOUT_MS (30 000).
   */
  timeoutMs?: number;
}

/**
 * Run `op` exclusively (one launcher operation at a time) and apply an
 * optional settle barrier before releasing the queue for the next operation.
 *
 * The queue is implemented as a promise chain: each call appends a new gate
 * promise and waits for the previous tail to resolve before running.  The
 * gate resolves in the `finally` block so it is always released — even when
 * `op` or the settle barrier throws.
 *
 * @param op     - Launcher-touching operation to run exclusively.
 * @param settle - Settle barrier config.  Defaults to `{ type: "none" }`.
 * @returns The value returned by `op`.
 */
export async function withLauncherQueue<T>(
  op: () => Promise<T>,
  settle: LauncherQueueSettleOptions = { type: "none" },
): Promise<T> {
  // Append a new gate to the queue tail.
  let resolveGate!: () => void;
  const gate = new Promise<void>((r) => {
    resolveGate = r;
  });
  const prev = _queueTail;
  _queueTail = gate;

  // Block until the previous op (and its settle barrier) has finished.
  await prev;

  let result: T;
  try {
    result = await op();

    // Settle barrier: give the launcher and instance time to stabilise before
    // allowing the next queued operation to start.
    if (settle.type !== "none") {
      await applySettleBarrier(settle).catch(() => {
        // Settle is best-effort — a timeout must not block the queue forever.
      });
    }
  } finally {
    // Invalidate the process-inspection cache after every lifecycle op so the
    // next check-status / scan sees fresh data.
    invalidateProcessCache();
    resolveGate();
  }

  return result;
}

// ---------------------------------------------------------------------------
// Settle barrier (private)
// ---------------------------------------------------------------------------

async function applySettleBarrier(opts: LauncherQueueSettleOptions): Promise<void> {
  const budget = opts.timeoutMs ?? getSettleTimeoutMs();
  const deadline = Date.now() + budget;

  // (a) Launcher CDP reachable — re-discover if needed.
  if (opts.type !== "none") {
    const remaining = Math.max(1_000, deadline - Date.now());
    try {
      await resolveAppPort("launcher", remaining);
    } catch {
      // Launcher didn't recover within the budget; proceed so the queue
      // is not held indefinitely.  The next queued op's withLauncherRecovery
      // will handle reconnection.
    }
  }

  // (b) Target instance connectable (only meaningful for "start" ops).
  if (opts.type === "start" && opts.accountId !== undefined) {
    const remaining = Math.max(0, deadline - Date.now());
    if (remaining > 0) {
      await waitForConnectable(opts.accountId, {
        timeoutMs: remaining,
        ...(opts.knownPort !== undefined ? { knownPort: opts.knownPort } : {}),
      });
    }
  }
}
