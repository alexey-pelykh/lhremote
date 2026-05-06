// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import { delay } from "../utils/delay.js";
import type { InstanceService } from "../services/instance.js";
import {
  LoggedInStateTimeoutError,
  waitForLoggedInState,
} from "./wait-for-logged-in-state.js";

interface ProbeShape {
  ok: boolean;
  reason?: string;
  hostname?: string;
  pathname?: string;
}

function makeInstance(probe: () => Promise<ProbeShape> | ProbeShape) {
  return {
    evaluateLinkedIn: vi.fn().mockImplementation(async () => probe()),
  } as unknown as InstanceService;
}

describe("waitForLoggedInState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns immediately when the first probe reports ok", async () => {
    const instance = makeInstance(() => ({
      ok: true,
      hostname: "www.linkedin.com",
      pathname: "/feed/",
    }));

    await waitForLoggedInState(instance);

    expect(instance.evaluateLinkedIn).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("polls until the probe reports ok", async () => {
    let calls = 0;
    const instance = makeInstance(() => {
      calls++;
      return calls < 3
        ? { ok: false, reason: "me-not-rendered" }
        : { ok: true };
    });

    await waitForLoggedInState(instance, { pollInterval: 100, timeout: 60_000 });

    expect(instance.evaluateLinkedIn).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
    // delay receives the configured pollInterval
    expect(delay).toHaveBeenCalledWith(100);
  });

  it("throws LoggedInStateTimeoutError when probe never reports ok", async () => {
    const probeMock = vi.fn().mockResolvedValue({
      ok: false,
      reason: "wrong-path",
      pathname: "/checkpoint/challenge/",
    });
    const instance = {
      evaluateLinkedIn: probeMock,
    } as unknown as InstanceService;

    // Use a very small timeout — with mocked `delay`, real elapsed time
    // crosses 1ms within a handful of synchronous iterations.
    await expect(
      waitForLoggedInState(instance, { timeout: 1, pollInterval: 1 }),
    ).rejects.toBeInstanceOf(LoggedInStateTimeoutError);
  });

  it("preserves the lastReason on the timeout error", async () => {
    const probeMock = vi.fn().mockResolvedValue({
      ok: false,
      reason: "wrong-host",
      hostname: "example.com",
    });
    const instance = {
      evaluateLinkedIn: probeMock,
    } as unknown as InstanceService;

    try {
      await waitForLoggedInState(instance, { timeout: 1, pollInterval: 1 });
      expect.unreachable("expected LoggedInStateTimeoutError");
    } catch (err) {
      expect(err).toBeInstanceOf(LoggedInStateTimeoutError);
      const e = err as LoggedInStateTimeoutError;
      expect(e.lastReason).toBe("wrong-host");
      expect(e.waitedMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("treats probe-time exceptions as transient and retries", async () => {
    let calls = 0;
    const instance = makeInstance(() => {
      calls++;
      if (calls === 1) throw new Error("CDP disconnected");
      if (calls === 2) return { ok: false, reason: "me-not-rendered" };
      return { ok: true };
    });

    await waitForLoggedInState(instance, { pollInterval: 1, timeout: 60_000 });

    expect(instance.evaluateLinkedIn).toHaveBeenCalledTimes(3);
  });

  it("surfaces the throw reason in the timeout error when probes always throw", async () => {
    const probeMock = vi.fn().mockImplementation(() => {
      throw new Error("CDP disconnected");
    });
    const instance = {
      evaluateLinkedIn: probeMock,
    } as unknown as InstanceService;

    try {
      await waitForLoggedInState(instance, { timeout: 1, pollInterval: 1 });
      expect.unreachable("expected LoggedInStateTimeoutError");
    } catch (err) {
      expect(err).toBeInstanceOf(LoggedInStateTimeoutError);
      const e = err as LoggedInStateTimeoutError;
      expect(e.lastReason).toContain("probe-threw");
      expect(e.lastReason).toContain("CDP disconnected");
    }
  });

  it("returns ok as soon as one probe succeeds even if a later one would not", async () => {
    let calls = 0;
    const instance = makeInstance(() => {
      calls++;
      if (calls === 1) return { ok: true };
      // Subsequent probes would fail, but the helper should have already returned.
      return { ok: false, reason: "me-not-rendered" };
    });

    await waitForLoggedInState(instance);

    expect(instance.evaluateLinkedIn).toHaveBeenCalledTimes(1);
  });
});
