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
 *
 * The same file also pins `LHREMOTE_CAPTURE_DIAGNOSTICS` off for Tier 1 (#925),
 * and the second suite below grades that.  It is a separate property with a
 * separate failure mode: the network guard going quiet puts unit tests back on
 * the network, while the pin going quiet puts them back to writing real
 * diagnostic bundles — LinkedIn page content — out of a green run.
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

/**
 * The capture pin's test-only handle, exposed on `globalThis` by
 * `vitest.setup.ts`.  It carries the ambient value the pin captured, which is
 * what makes the assertions below non-degenerate — see the first test.
 */
interface Tier1CaptureDiagnosticsGuard {
  ambient: string | undefined;
}

function captureGuard(): Tier1CaptureDiagnosticsGuard | undefined {
  return (
    globalThis as {
      __tier1CaptureDiagnosticsGuard?: Tier1CaptureDiagnosticsGuard;
    }
  ).__tier1CaptureDiagnosticsGuard;
}

describe("Tier-1 diagnostic-capture pin", () => {
  it("installs its test handle, carrying the ambient value it pinned away", () => {
    // Asserting the HANDLE — not just that the variable is unset — is the
    // whole point. In CI nobody exports LHREMOTE_CAPTURE_DIAGNOSTICS, so an
    // `expect(process.env.…).toBeUndefined()` on its own would pass there
    // whether or not vitest.setup.ts ran at all: a gate that cannot fail on
    // the machine it usually runs on. The handle exists only if the pin ran.
    const handle = captureGuard();
    expect(handle).toBeDefined();
    expect(handle).toHaveProperty("ambient");
  });

  it("leaves LHREMOTE_CAPTURE_DIAGNOSTICS unset whatever the shell exported", () => {
    expect(process.env.LHREMOTE_CAPTURE_DIAGNOSTICS).toBeUndefined();
  });

  it("dirties the variable, to be caught by the test after it", () => {
    // Deliberately NOT restored. This test and the one below are a pair: the
    // pin's `beforeEach` is what cleans up after this, and the next test is
    // the only thing that observes it doing so. Vitest runs tests within a
    // file in declaration order by default, so "the one below" is the next to
    // run — the coupling is real but invisible, hence this comment. Reordering
    // or moving either test between describes breaks the assertion silently.
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    expect(process.env.LHREMOTE_CAPTURE_DIAGNOSTICS).toBe("1");
  });

  it("re-pins before each test, so the one above cannot leak into this one", () => {
    expect(process.env.LHREMOTE_CAPTURE_DIAGNOSTICS).toBeUndefined();
  });

  it("lets a test opt back in for its own body", () => {
    // The pin must not defeat the ~17 sites that deliberately set the variable
    // inside an `it()` body to grade the capture path. An in-test assignment
    // happens after the pin's `beforeEach`, so it wins.
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    expect(process.env.LHREMOTE_CAPTURE_DIAGNOSTICS).toBe("1");
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
  });
});
