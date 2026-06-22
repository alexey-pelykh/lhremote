// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../cdp/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cdp/index.js")>();
  return { ...actual, invalidateProcessCache: vi.fn() };
});

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import { invalidateProcessCache } from "../cdp/index.js";
import { waitForPidExit } from "./instance-lifecycle.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("waitForPidExit", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    killSpy = vi.spyOn(process, "kill");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns immediately when the process does not exist (ESRCH)", async () => {
    const esrch = Object.assign(new Error("No such process"), { code: "ESRCH" });
    killSpy.mockImplementation(() => { throw esrch; });

    await expect(waitForPidExit(12345, 5_000)).resolves.toBeUndefined();
    expect(invalidateProcessCache).toHaveBeenCalled();
  });

  it("treats EPERM as still alive (no permission to signal)", async () => {
    const eperm = Object.assign(new Error("Operation not permitted"), { code: "EPERM" });
    killSpy.mockImplementation(() => { throw eperm; });

    // With a 0 timeout, it should time out and still be alive (EPERM = alive)
    await expect(waitForPidExit(12345, 0)).resolves.toBeUndefined();
  });

  it("polls until ESRCH on the second call", async () => {
    let calls = 0;
    killSpy.mockImplementation(() => {
      calls++;
      if (calls >= 2) {
        const esrch = Object.assign(new Error("No such process"), { code: "ESRCH" });
        throw esrch;
      }
      // First call: signal 0 succeeds (process still alive)
    });

    await waitForPidExit(12345, 5_000);

    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("calls invalidateProcessCache before each check", async () => {
    const esrch = Object.assign(new Error("No such process"), { code: "ESRCH" });
    killSpy.mockImplementation(() => { throw esrch; });

    await waitForPidExit(12345, 5_000);

    expect(vi.mocked(invalidateProcessCache)).toHaveBeenCalled();
  });

  it("uses signal 0 (existence check, no actual signal sent)", async () => {
    const esrch = Object.assign(new Error("No such process"), { code: "ESRCH" });
    killSpy.mockImplementation(() => { throw esrch; });

    await waitForPidExit(99999, 5_000);

    expect(killSpy).toHaveBeenCalledWith(99999, 0);
  });

  it("returns after timeout even when process never exits", async () => {
    // Signal 0 always succeeds = process always alive
    killSpy.mockReturnValue(undefined);

    // timeoutMs: 0 → deadline already passed, exits immediately
    await expect(waitForPidExit(12345, 0)).resolves.toBeUndefined();
  });
});
