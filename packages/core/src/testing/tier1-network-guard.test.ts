// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

/**
 * The guard in `vitest.setup.ts` is what stops a Tier-1 suite depending on
 * machine state.  Nothing else would notice if its `setupFiles` entry were
 * dropped from `vitest.config.ts`, or if this package stopped resolving that
 * config — the suite would simply go quiet, which is the shape of the original
 * bug one level up.  This file is that notice.
 *
 * It exercises the guard rather than merely checking that some replacement is
 * installed: a pass-through that kept the function name would satisfy an
 * identity check while letting every unit test back onto the network.
 *
 * Draining after each assertion is not incidental — the guard records what it
 * blocks and its `afterEach`/`afterAll` hooks fail the test on anything left
 * behind, so a test that deliberately trips it must clear its own record.
 */

/** The guard's test-only handle, exposed on `globalThis` by `vitest.setup.ts`. */
interface Tier1NetworkGuard {
  drain: () => string[];
}

function guard(): Tier1NetworkGuard {
  const handle = (globalThis as { __tier1NetworkGuard?: Tier1NetworkGuard })
    .__tier1NetworkGuard;
  if (handle === undefined) {
    throw new Error(
      "Tier-1 network guard is not installed — vitest.setup.ts did not run " +
        "for this file. Check the setupFiles entry in vitest.config.ts.",
    );
  }
  return handle;
}

describe("Tier-1 network guard", () => {
  it("blocks fetch and names the target", () => {
    expect(() => fetch("http://127.0.0.1:9222/json/list")).toThrow(
      "http://127.0.0.1:9222/json/list",
    );
    expect(guard().drain()).toHaveLength(1);
  });

  it("blocks a new WebSocket and names the target", () => {
    expect(() => new WebSocket("ws://127.0.0.1:9222/devtools/page/X")).toThrow(
      "ws://127.0.0.1:9222/devtools/page/X",
    );
    expect(guard().drain()).toHaveLength(1);
  });

  it("records a swallowed call, so a drain hook can still fail it", async () => {
    // The isCdpPort() shape: catch { return false }. The thrown error never
    // reaches the test, which is why recording exists at all.
    let reached = false;
    try {
      await fetch("http://127.0.0.1:9222/json/list");
      reached = true;
    } catch {
      reached = false;
    }

    expect(reached).toBe(false);
    const recorded = guard().drain();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toContain("http://127.0.0.1:9222/json/list");
  });

  it("leaves a test that touches no network alone", () => {
    expect(guard().drain()).toHaveLength(0);
  });
});
