// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import { delay } from "../utils/delay.js";
import type { InstanceService } from "../services/instance.js";
import type { InstancePopup } from "../types/index.js";
import {
  MonitorCollectingSagaTimeoutError,
  monitorCollectingSaga,
} from "./monitor-collecting-saga.js";

interface ProbeShape {
  collecting: boolean;
  preparing: boolean;
  error?: string;
}

function makeInstance(opts: {
  probe: () => ProbeShape | Promise<ProbeShape>;
  popups?: () => InstancePopup[] | Promise<InstancePopup[]>;
  dismiss?: () => { dismissed: number; nonDismissable: number };
}) {
  return {
    evaluateUI: vi.fn().mockImplementation(async () => opts.probe()),
    getInstancePopups: vi
      .fn()
      .mockImplementation(async () =>
        opts.popups ? opts.popups() : [],
      ),
    dismissInstancePopups: vi
      .fn()
      .mockImplementation(async () =>
        opts.dismiss
          ? opts.dismiss()
          : { dismissed: 0, nonDismissable: 0 },
      ),
  } as unknown as InstanceService;
}

describe("monitorCollectingSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns reachedIdle=true immediately when saga is already idle and allowImmediateIdle defaults true", async () => {
    const instance = makeInstance({
      probe: () => ({ collecting: false, preparing: false }),
    });

    const result = await monitorCollectingSaga(instance);

    expect(result.reachedIdle).toBe(true);
    expect(result.recoveryEvents).toBe(0);
    expect(result.popupsDismissed).toBe(0);
    expect(result.unrecoverablePopups).toEqual([]);
    expect(instance.evaluateUI).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("does NOT treat a probe with error as idle (keeps polling instead)", async () => {
    let calls = 0;
    const instance = makeInstance({
      probe: () => {
        calls++;
        if (calls < 3) {
          // Probe failure (e.g., no-main-window, transient CDP error) — must NOT be classified as idle
          return {
            collecting: false,
            preparing: false,
            error: "no-main-window",
          };
        }
        if (calls === 3) {
          return { collecting: true, preparing: false };
        }
        return { collecting: false, preparing: false };
      },
    });

    const result = await monitorCollectingSaga(instance, {
      timeout: 60_000,
      pollInterval: 1,
    });

    // Without the fix, the first probe with `error` would have returned reachedIdle=true
    // immediately under allowImmediateIdle=true (default).  With the fix, the loop keeps
    // polling until the probe succeeds and reports active, then idle.
    expect(result.reachedIdle).toBe(true);
    expect(instance.evaluateUI).toHaveBeenCalledTimes(4);
  });

  it("times out when allowImmediateIdle=false and saga never starts", async () => {
    const instance = makeInstance({
      probe: () => ({ collecting: false, preparing: false }),
    });

    await expect(
      monitorCollectingSaga(instance, {
        timeout: 1,
        pollInterval: 1,
        allowImmediateIdle: false,
      }),
    ).rejects.toBeInstanceOf(MonitorCollectingSagaTimeoutError);
  });

  it("polls until saga transitions from collecting to idle", async () => {
    let calls = 0;
    const instance = makeInstance({
      probe: () => {
        calls++;
        if (calls < 3) return { collecting: true, preparing: false };
        return { collecting: false, preparing: false };
      },
    });

    const result = await monitorCollectingSaga(instance, {
      timeout: 60_000,
      pollInterval: 100,
    });

    expect(result.reachedIdle).toBe(true);
    expect(instance.evaluateUI).toHaveBeenCalledTimes(3);
    // 2 polls saw collecting=true, each followed by a delay
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it("treats preparing=true as saga active (not idle)", async () => {
    let calls = 0;
    const instance = makeInstance({
      probe: () => {
        calls++;
        if (calls === 1) return { collecting: false, preparing: true };
        return { collecting: false, preparing: false };
      },
    });

    const result = await monitorCollectingSaga(instance, {
      timeout: 60_000,
      pollInterval: 1,
    });

    expect(result.reachedIdle).toBe(true);
    expect(instance.evaluateUI).toHaveBeenCalledTimes(2);
  });

  it("dismisses recoverable IncorrectContentStateError popups and counts events", async () => {
    let probeCalls = 0;
    let popupCalls = 0;
    const dismiss = vi.fn(() => ({ dismissed: 2, nonDismissable: 0 }));
    const instance = makeInstance({
      probe: () => {
        probeCalls++;
        if (probeCalls < 3) return { collecting: true, preparing: false };
        return { collecting: false, preparing: false };
      },
      popups: () => {
        popupCalls++;
        if (popupCalls < 3) {
          return [
            {
              title: "Action.IncorrectContentStateError",
              description: "Incorrect web-page state state `li-logged-in-loading` is not `LoggedInState`",
              closable: true,
            },
            {
              title: "Action.IncorrectContentStateError (retry 2)",
              description: "li-logged-in-loading",
              closable: true,
            },
          ];
        }
        return [];
      },
      dismiss,
    });

    const result = await monitorCollectingSaga(instance, {
      timeout: 60_000,
      pollInterval: 1,
    });

    expect(result.reachedIdle).toBe(true);
    // 2 polls saw all-recoverable popups → 2 recoveryEvents, dismiss called twice with 2 each = 4
    expect(result.recoveryEvents).toBe(2);
    expect(result.popupsDismissed).toBe(4);
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it("records unrecoverable popups deduplicated by title", async () => {
    let probeCalls = 0;
    let popupCalls = 0;
    const instance = makeInstance({
      probe: () => {
        probeCalls++;
        if (probeCalls < 4) return { collecting: true, preparing: false };
        return { collecting: false, preparing: false };
      },
      popups: () => {
        popupCalls++;
        if (popupCalls === 1) {
          return [
            {
              title: "Account locked",
              description: "Your account is restricted",
              closable: true,
            },
          ];
        }
        if (popupCalls === 2) {
          return [
            {
              title: "Account locked",
              description: "Your account is restricted",
              closable: true,
            }, // duplicate title — should NOT add a second entry
            {
              title: "Checkpoint challenge",
              description: "Please verify your identity",
              closable: true,
            },
          ];
        }
        return [];
      },
      dismiss: () => ({ dismissed: 1, nonDismissable: 0 }),
    });

    const result = await monitorCollectingSaga(instance, {
      timeout: 60_000,
      pollInterval: 1,
    });

    expect(result.reachedIdle).toBe(true);
    expect(result.unrecoverablePopups).toHaveLength(2);
    expect(result.unrecoverablePopups[0]?.title).toBe("Account locked");
    expect(result.unrecoverablePopups[1]?.title).toBe("Checkpoint challenge");
    // No recoverable popups → recoveryEvents stays at 0
    expect(result.recoveryEvents).toBe(0);
  });

  it("does NOT dismiss when any unrecoverable popup is present (preserves visibility of critical issues)", async () => {
    let probeCalls = 0;
    let popupCalls = 0;
    const dismiss = vi.fn(() => ({ dismissed: 2, nonDismissable: 0 }));
    const instance = makeInstance({
      probe: () => {
        probeCalls++;
        if (probeCalls < 2) return { collecting: true, preparing: false };
        return { collecting: false, preparing: false };
      },
      popups: () => {
        popupCalls++;
        if (popupCalls === 1) {
          return [
            {
              title: "Action.IncorrectContentStateError",
              description: "li-logged-in-loading",
              closable: true,
            },
            {
              title: "Account locked",
              description: "Your account is restricted",
              closable: true,
            },
          ];
        }
        return [];
      },
      dismiss,
    });

    const result = await monitorCollectingSaga(instance, {
      timeout: 60_000,
      pollInterval: 1,
    });

    expect(result.reachedIdle).toBe(true);
    // mixed iteration → no dismissal happens
    expect(result.recoveryEvents).toBe(0);
    expect(result.popupsDismissed).toBe(0);
    expect(dismiss).not.toHaveBeenCalled();
    // unrecoverable still captured (titled-deduped)
    expect(result.unrecoverablePopups).toHaveLength(1);
    expect(result.unrecoverablePopups[0]?.title).toBe("Account locked");
  });

  it("throws MonitorCollectingSagaTimeoutError when saga never reaches idle", async () => {
    const instance = makeInstance({
      probe: () => ({ collecting: true, preparing: false }),
    });

    try {
      await monitorCollectingSaga(instance, {
        timeout: 1,
        pollInterval: 1,
      });
      expect.unreachable("expected MonitorCollectingSagaTimeoutError");
    } catch (err) {
      expect(err).toBeInstanceOf(MonitorCollectingSagaTimeoutError);
      const e = err as MonitorCollectingSagaTimeoutError;
      expect(e.waitedMs).toBeGreaterThanOrEqual(0);
      expect(e.recoveryEvents).toBeGreaterThanOrEqual(0);
    }
  });

  it("propagates accumulated state into the timeout error", async () => {
    const instance = makeInstance({
      probe: () => ({ collecting: true, preparing: false }),
      popups: () => [
        {
          title: "Action.IncorrectContentStateError",
          description: "li-logged-in-loading",
          closable: true,
        },
      ],
      dismiss: () => ({ dismissed: 1, nonDismissable: 0 }),
    });

    try {
      await monitorCollectingSaga(instance, {
        // 50 ms gives the loop room to enter and complete at least one
        // iteration even under slow CI (Ubuntu + vitest --coverage).
        // With timeout=1 the deadline (start + 1 ms) can expire before
        // `while (Date.now() < deadline)` evaluates the first time —
        // millisecond quantization + scheduling overhead between the
        // `start = Date.now()` capture and the loop entry — causing the
        // body to never run, so recoveryEvents stays 0 and the >= 1
        // assertion fails. (`delay` is mocked to resolve immediately;
        // pollInterval timing is not the flake source.)
        timeout: 50,
        pollInterval: 1,
      });
      expect.unreachable("expected MonitorCollectingSagaTimeoutError");
    } catch (err) {
      expect(err).toBeInstanceOf(MonitorCollectingSagaTimeoutError);
      const e = err as MonitorCollectingSagaTimeoutError;
      // recoverable-only iteration → recovery events accumulate
      expect(e.recoveryEvents).toBeGreaterThanOrEqual(1);
      expect(e.popupsDismissed).toBeGreaterThanOrEqual(1);
    }
  });
});
