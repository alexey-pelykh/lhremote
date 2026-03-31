// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { delay, gaussianBetween } from "./delay.js";

/**
 * Compute the session rhythm multiplier based on operation count.
 *
 * Models the natural pacing of a human browsing session:
 * - **Warm-up (ops 0–2):** 1.5× — slower, exploring, getting oriented
 * - **Cruising (ops 3–8):** 0.85× — in the flow, comfortable pace
 * - **Fatigue (ops 9+):** 1.0 + 0.05 × (n − 8) — gradually slowing down
 */
export function rhythmMultiplier(operationCount: number): number {
  if (operationCount <= 2) return 1.5;
  if (operationCount <= 8) return 0.85;
  return 1.0 + 0.05 * (operationCount - 8);
}

/**
 * Session-level pacer that tracks inter-operation timing and enforces
 * minimum gaps between operations to prevent rapid-fire automation patterns.
 *
 * Each operation should call {@link paceBeforeOperation} before starting
 * and {@link recordOperationEnd} after completing.  The pacer applies a
 * Gaussian-distributed cool-down scaled by a session rhythm multiplier
 * that models warm-up, cruising, and fatigue phases.
 */
export class SessionPacer {
  private lastOperationEnd = 0;
  private operationCount = 0;

  /** Call before starting an operation.  Resolves after the appropriate cool-down. */
  async paceBeforeOperation(operationType: "read" | "write"): Promise<void> {
    const now = Date.now();

    // First operation — no cool-down needed
    if (this.lastOperationEnd === 0) return;

    const elapsed = now - this.lastOperationEnd;
    const multiplier = rhythmMultiplier(this.operationCount);

    // Base cool-down parameters per operation type
    const baseDelay =
      operationType === "read"
        ? gaussianBetween(2_500, 800, 1_000, 5_000)
        : gaussianBetween(8_000, 3_000, 3_000, 18_000);

    const required = baseDelay * multiplier;
    const remaining = required - elapsed;

    if (remaining > 0) {
      await delay(remaining);
    }
  }

  /** Call after an operation completes to record its end timestamp. */
  recordOperationEnd(): void {
    this.lastOperationEnd = Date.now();
    this.operationCount++;
  }
}
