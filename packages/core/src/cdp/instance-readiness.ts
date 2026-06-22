// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Instance readiness model (T2).
 *
 * Tracks per-instance readiness state across successive process scans so
 * callers can distinguish transient unreachability (grace window) from a
 * genuinely stuck instance.
 *
 * State model per instance PID:
 *   starting  — process is alive but has never been seen connectable yet
 *   connectable — CDP probe succeeds; the instance is healthy
 *   degraded  — was connectable before; temporarily unreachable within the grace window
 *   stuck     — has been non-connectable longer than the grace window
 *
 * Only `stuck` is eligible for restart/reap.  `degraded` and `starting`
 * instances should be given more time before intervention.
 *
 * Timing defaults (all configurable via env):
 *   LHREMOTE_GRACE_WINDOW_MS          30 000 — grace window before "stuck"
 *   LHREMOTE_CONNECTABLE_TIMEOUT_MS   45 000 — waitForConnectable overall timeout
 *   LHREMOTE_CONNECTABLE_INTERVAL_MS   1 500 — poll interval inside waitForConnectable
 */

import { isCdpPort } from "../utils/cdp-port.js";
import { delay } from "../utils/delay.js";
import { scanRunningInstances } from "./process-inspector.js";
import type { RunningInstance } from "./process-inspector.js";

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

export const DEFAULT_GRACE_WINDOW_MS = 30_000;
export const DEFAULT_CONNECTABLE_TIMEOUT_MS = 45_000;
export const DEFAULT_CONNECTABLE_INTERVAL_MS = 1_500;

function getGraceWindowMs(): number {
  const v = process.env["LHREMOTE_GRACE_WINDOW_MS"];
  return v ? Number(v) : DEFAULT_GRACE_WINDOW_MS;
}

function getConnectableTimeoutMs(): number {
  const v = process.env["LHREMOTE_CONNECTABLE_TIMEOUT_MS"];
  return v ? Number(v) : DEFAULT_CONNECTABLE_TIMEOUT_MS;
}

function getConnectableIntervalMs(): number {
  const v = process.env["LHREMOTE_CONNECTABLE_INTERVAL_MS"];
  return v ? Number(v) : DEFAULT_CONNECTABLE_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-instance readiness state. */
export type InstanceReadiness = "connectable" | "starting" | "degraded" | "stuck";

/** Options for {@link waitForConnectable}. */
export interface WaitForConnectableOptions {
  /** Overall wait budget in ms. Default: LHREMOTE_CONNECTABLE_TIMEOUT_MS (45 000). */
  timeoutMs?: number;
  /** Poll interval in ms. Default: LHREMOTE_CONNECTABLE_INTERVAL_MS (1 500). */
  intervalMs?: number;
  /**
   * CDP port returned by a previous start operation.  When provided, a cheap
   * `isCdpPort` probe is tried first before paying the full process-scan cost.
   */
  knownPort?: number;
}

/** Result returned by {@link waitForConnectable}. */
export interface WaitForConnectableResult {
  cdpPort: number | null;
  pid: number | undefined;
  /** True when a connectable instance with the correct `accountId` was found. */
  verified: boolean;
}

// ---------------------------------------------------------------------------
// InstanceReadinessTracker (process-scoped singleton)
// ---------------------------------------------------------------------------

/**
 * Stateful tracker that computes per-instance readiness across successive scans.
 *
 * Because connectability is eventually-consistent, a single scan is not
 * sufficient to distinguish "just starting" from "stuck".  This tracker
 * records when each PID was first seen non-connectable, enabling the grace-
 * window check without requiring the caller to thread state through.
 *
 * The module exports a singleton ({@link readinessTracker}) that is shared
 * across all callers in the same Node.js process.
 */
export class InstanceReadinessTracker {
  /** PIDs that have been seen connectable at least once. */
  private seenConnectable = new Set<number>();
  /** PID → timestamp (ms) when first observed non-connectable. */
  private unreachableSince = new Map<number, number>();

  /**
   * Update internal state from a fresh process scan and return the readiness
   * state for each running instance PID.
   *
   * Stale entries for PIDs that are no longer running are pruned automatically.
   */
  update(
    instances: RunningInstance[],
    graceWindowMs = getGraceWindowMs(),
  ): Map<number, InstanceReadiness> {
    const now = Date.now();
    const livePids = new Set(instances.map((i) => i.pid));

    // Prune entries for PIDs that are no longer running
    for (const pid of this.unreachableSince.keys()) {
      if (!livePids.has(pid)) this.unreachableSince.delete(pid);
    }
    for (const pid of this.seenConnectable) {
      if (!livePids.has(pid)) this.seenConnectable.delete(pid);
    }

    const result = new Map<number, InstanceReadiness>();

    for (const inst of instances) {
      const { pid } = inst;
      if (inst.connectable) {
        this.seenConnectable.add(pid);
        this.unreachableSince.delete(pid);
        result.set(pid, "connectable");
      } else {
        if (!this.unreachableSince.has(pid)) {
          this.unreachableSince.set(pid, now);
        }
        const since = this.unreachableSince.get(pid) ?? now;
        const elapsed = now - since;
        if (elapsed >= graceWindowMs) {
          result.set(pid, "stuck");
        } else if (this.seenConnectable.has(pid)) {
          result.set(pid, "degraded");
        } else {
          result.set(pid, "starting");
        }
      }
    }

    return result;
  }

  /**
   * Invalidate tracked state for a specific PID, or all PIDs when omitted.
   *
   * Call this after a lifecycle op (start/stop/restart) so stale state does
   * not affect the next readiness computation.
   */
  invalidate(pid?: number): void {
    if (pid !== undefined) {
      this.seenConnectable.delete(pid);
      this.unreachableSince.delete(pid);
    } else {
      this.seenConnectable.clear();
      this.unreachableSince.clear();
    }
  }
}

/** Process-scoped singleton readiness tracker. */
export const readinessTracker = new InstanceReadinessTracker();

// ---------------------------------------------------------------------------
// waitForConnectable
// ---------------------------------------------------------------------------

/**
 * Poll until the account's instance is connectable on a real, distinct port,
 * or until the timeout expires.
 *
 * When `knownPort` is supplied, a cheap {@link isCdpPort} probe is tried
 * before each full process scan, reducing WMI/ps-list overhead during the
 * typical case where the instance comes up on the expected port.
 *
 * Timeout and interval are configurable via env vars:
 *   LHREMOTE_CONNECTABLE_TIMEOUT_MS   (default 45 000)
 *   LHREMOTE_CONNECTABLE_INTERVAL_MS  (default 1 500)
 */
export async function waitForConnectable(
  accountId: number,
  options?: WaitForConnectableOptions,
): Promise<WaitForConnectableResult> {
  const timeoutMs = options?.timeoutMs ?? getConnectableTimeoutMs();
  const intervalMs = options?.intervalMs ?? getConnectableIntervalMs();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Cheap path: probe the known port directly before paying for a full scan.
    if (options?.knownPort !== undefined) {
      if (await isCdpPort(options.knownPort)) {
        // Port is alive — do one full scan to confirm identity.
        const instances = await scanRunningInstances();
        readinessTracker.update(instances);
        const match = instances.find(
          (i) =>
            i.accountId === accountId &&
            i.connectable &&
            i.cdpPort === options.knownPort,
        );
        if (match) {
          return { cdpPort: match.cdpPort, pid: match.pid, verified: true };
        }
        // Port is alive but identity doesn't match — fall through to full scan.
      }
    }

    // Full scan path.
    const instances = await scanRunningInstances();
    readinessTracker.update(instances);
    const match = instances.find(
      (i) => i.accountId === accountId && i.connectable,
    );
    if (match) {
      return { cdpPort: match.cdpPort, pid: match.pid, verified: true };
    }

    await delay(intervalMs);
  }

  return { cdpPort: null, pid: undefined, verified: false };
}
