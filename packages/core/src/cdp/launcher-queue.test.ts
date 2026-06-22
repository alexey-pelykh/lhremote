// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before the tested module is imported
// ---------------------------------------------------------------------------

vi.mock("./app-discovery.js", () => ({
  resolveAppPort: vi.fn().mockResolvedValue(9222),
}));

vi.mock("./gather-raw-processes.js", () => ({
  invalidateProcessCache: vi.fn(),
}));

vi.mock("./instance-readiness.js", () => ({
  waitForConnectable: vi.fn().mockResolvedValue({ cdpPort: 55001, pid: 100, verified: true }),
}));

import { resolveAppPort } from "./app-discovery.js";
import { invalidateProcessCache } from "./gather-raw-processes.js";
import { withLauncherQueue } from "./launcher-queue.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("withLauncherQueue", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs a single operation and returns its value", async () => {
    const result = await withLauncherQueue(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("invalidates the process cache after every op (even on failure)", async () => {
    await withLauncherQueue(() => Promise.resolve("ok")).catch(() => {});
    expect(vi.mocked(invalidateProcessCache)).toHaveBeenCalledTimes(1);

    vi.mocked(invalidateProcessCache).mockClear();

    await withLauncherQueue(() => Promise.reject(new Error("boom"))).catch(() => {});
    expect(vi.mocked(invalidateProcessCache)).toHaveBeenCalledTimes(1);
  });

  it("serializes two concurrent calls — no overlap", async () => {
    const log: string[] = [];
    let op1Done = false;

    const op1 = withLauncherQueue(async () => {
      log.push("op1:start");
      await new Promise<void>((r) => setTimeout(r, 20));
      op1Done = true;
      log.push("op1:end");
    });

    const op2 = withLauncherQueue(async () => {
      log.push("op2:start");
      // op1 must be done before op2 starts (no overlap)
      expect(op1Done).toBe(true);
      log.push("op2:end");
    });

    await Promise.all([op1, op2]);
    expect(log).toEqual(["op1:start", "op1:end", "op2:start", "op2:end"]);
  });

  it("serializes three concurrent calls in FIFO order", async () => {
    const log: string[] = [];

    const ops = [0, 1, 2].map((i) =>
      withLauncherQueue(async () => {
        log.push(`op${i}`);
      }),
    );
    await Promise.all(ops);
    expect(log).toEqual(["op0", "op1", "op2"]);
  });

  it("releases the queue even when op throws", async () => {
    await withLauncherQueue(() => Promise.reject(new Error("fail"))).catch(() => {});

    // A subsequent op should still run
    const result = await withLauncherQueue(() => Promise.resolve("recovered"));
    expect(result).toBe("recovered");
  });

  it("applies the settle barrier for type:start (launcher + instance check)", async () => {
    await withLauncherQueue(
      () => Promise.resolve(),
      { type: "start", accountId: 42, launcherPort: 9222 },
    );

    expect(vi.mocked(resolveAppPort)).toHaveBeenCalledWith(
      "launcher",
      expect.any(Number),
    );
  });

  it("applies the settle barrier for type:stop (launcher check only)", async () => {
    await withLauncherQueue(
      () => Promise.resolve(),
      { type: "stop", launcherPort: 9222 },
    );

    expect(vi.mocked(resolveAppPort)).toHaveBeenCalledWith(
      "launcher",
      expect.any(Number),
    );
  });

  it("does NOT call resolveAppPort for type:none", async () => {
    await withLauncherQueue(() => Promise.resolve(), { type: "none" });
    expect(vi.mocked(resolveAppPort)).not.toHaveBeenCalled();
  });

  it("does not block queue when settle barrier launcher-check fails", async () => {
    vi.mocked(resolveAppPort).mockRejectedValueOnce(new Error("no launcher"));

    await withLauncherQueue(
      () => Promise.resolve(),
      { type: "launcher", launcherPort: 9222 },
    );

    // Queue should still be released — a subsequent op must succeed
    const result = await withLauncherQueue(() => Promise.resolve("after"));
    expect(result).toBe("after");
  });
});
