// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/**
 * `LHREMOTE_CAPTURE_DIAGNOSTICS` as THIS module sees it at its own module
 * scope, captured at column 0 before any hook in this file has run.
 *
 * The pin deletes the variable at setup-file evaluation time — not only in
 * `beforeEach` — precisely so a suite reading it here sees the pinned state,
 * and two do (`search-posts.test.ts` and `search-posts-diagnostics.test.ts`,
 * each snapshotting it into a module-level `const`).  Nothing graded that
 * before: every other observer in this file reads inside an `it()` body, by
 * which time the `beforeEach` re-pin has fired and masks a missing
 * module-scope delete completely.
 */
const MODULE_SCOPE_CAPTURE_DIAGNOSTICS =
  process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;

/**
 * Set by the test that deliberately dirties the variable, read by the test
 * that grades the re-pin — see the pair below.
 *
 * Their coupling is declaration order, which vitest neither enforces nor
 * reports; this flag is what makes a broken coupling fail loudly instead of
 * passing vacuously.
 */
let dirtiedByPreviousTest = false;

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
    // Read INSIDE a test body, so the `beforeEach` re-pin has already fired:
    // this grades the state a test body sees, which is what every opt-in site
    // in the repo depends on. Kept alongside the module-scope assertion below
    // rather than folded into it, because the two grade different mechanisms
    // and only this one covers the state an ordinary test observes.
    //
    // Its failing condition needs a shell that exported the variable. Nobody
    // exports it in CI, so a green here is NOT by itself evidence that the pin
    // ran — that is what the handle assertion above is for, and the whole
    // reason the handle carries `ambient`.
    expect(process.env.LHREMOTE_CAPTURE_DIAGNOSTICS).toBeUndefined();
  });

  it("has already unset it by the time this module is evaluated", () => {
    // The module-scope delete is a SEPARATE mechanism from the `beforeEach`
    // re-pin, and this is the only assertion in the repo that can tell them
    // apart: remove `pinCaptureDiagnosticsOff()` from vitest.setup.ts's module
    // scope, leave the `beforeEach` alone, and every other observer here still
    // passes while this one fails.
    //
    // Same shell caveat as the assertion above — it can only FAIL where the
    // launching shell exported the variable, which CI never does. The
    // distinction it draws is between the two mechanisms, not between the two
    // shells; grading it therefore means running with
    // LHREMOTE_CAPTURE_DIAGNOSTICS=1 exported, which is exactly what makes the
    // #925 defect reproducible in the first place.
    expect(MODULE_SCOPE_CAPTURE_DIAGNOSTICS).toBeUndefined();
  });

  it("dirties the variable, to be caught by the test after it", () => {
    // Deliberately NOT restored. This test and the one below are a pair: the
    // pin's `beforeEach` is what cleans up after this, and the next test is
    // the only thing that observes it doing so. Vitest runs tests within a
    // file in declaration order by default, so "the one below" is the next to
    // run — the coupling is real but invisible, hence this comment and the
    // flag. Reordering, or moving either test between describes, used to break
    // the assertion silently.
    //
    // A FILTERED run is the same failure and the more likely one:
    // `vitest run -t "re-pins"` executes the second test alone, where its
    // `beforeEach` fires against a variable the module-scope pin already unset
    // — so it passes while grading nothing, in precisely the situation a
    // developer filtering by that name is investigating. The flag below turns
    // that vacuous pass into a loud failure that says why.
    dirtiedByPreviousTest = true;
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    expect(process.env.LHREMOTE_CAPTURE_DIAGNOSTICS).toBe("1");
  });

  it("re-pins before each test, so the one above cannot leak into this one", () => {
    expect(
      dirtiedByPreviousTest,
      'the test that dirties LHREMOTE_CAPTURE_DIAGNOSTICS did not run before ' +
        'this one, so there was nothing for the re-pin to clean up and this ' +
        'assertion grades nothing. Run the whole file rather than a `-t` ' +
        'filter, and keep the two tests adjacent and in this order.',
    ).toBe(true);
    expect(process.env.LHREMOTE_CAPTURE_DIAGNOSTICS).toBeUndefined();
  });

  describe("a describe-level opt-in", () => {
    // The pin must not defeat the sites throughout the repo that deliberately
    // set the variable to grade the capture path, and this is the shape of
    // those that CAN break: a `describe`-level `beforeEach`, which is how
    // `wait-for-post-load.test.ts` and `wait-for-reactions-modal.test.ts` opt
    // in. Its outcome depends on the runner's hook ordering rather than on
    // statement order inside one function body.
    //
    // The in-test-assignment form used to be tested here instead, and could
    // not fail: the pin's only per-test write is a `beforeEach` that has
    // completed before any body starts, and there is no `await` between a
    // body's `set` and its own `read` — so no implementation of this pin could
    // make that assertion fail, on any machine. It is documented rather than
    // asserted for that reason.
    //
    // What this grades instead: `@vitest/runner` recurses into the PARENT
    // suite first for `beforeEach`, and does not reverse `beforeEach` under
    // `sequence.hooks: "stack"`. Setup files are imported before the spec
    // module is collected, so the pin's hook sits on the root suite and runs
    // first, whatever the nesting depth. This fails if that ever inverts and
    // the pin starts winning over a deliberate describe-level opt-in.
    beforeEach(() => {
      process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    });

    afterEach(() => {
      // Back to the state the pin holds the rest of the file in. The pin's own
      // `beforeEach` would re-pin anyway; this keeps the opt-in from being the
      // last thing that touched the variable in this file.
      delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    });

    it("still sees the opt-in when the test body runs", () => {
      expect(process.env.LHREMOTE_CAPTURE_DIAGNOSTICS).toBe("1");
    });
  });
});

/**
 * The third property this file grades, and the only one that is about neither
 * guard's contents but about its SURVIVAL: that a suite which displaces a
 * guard gets it back before the next test runs.
 *
 * `vi.stubGlobal` is undone by neither `vi.resetAllMocks()` nor
 * `vi.restoreAllMocks()` — only `vi.unstubAllGlobals()`, or the `unstubGlobals`
 * config key this repo deliberately does not set (it fires from the runner's
 * `onBeforeTryTask`, i.e. before every test attempt, so it would tear down the
 * module-scope `WebSocket` stub `cdp/client.test.ts` holds on purpose).  A
 * suite that stubs `fetch` and never releases it therefore replaces the guard
 * for the remainder of its file, and the replacement fails open and silently:
 * the guard both throws and records, and the drain hooks fail the test on a
 * surviving recording, but a leftover `vi.fn()` does neither — after a reset it
 * returns `undefined`, and `await undefined` resolves (#935).
 *
 * The two tests below are deliberately IDENTICAL and deliberately
 * order-INdependent, which is the whole design.  Each displaces the guard
 * itself and asserts the guard is live at its own entry, so whichever runs
 * second is the one grading the `afterEach` — and no ordering can change that
 * one of them runs second.  Contrast the pair at the end of the suite above,
 * which needs its two members adjacent and in order: #937 wants
 * `sequence.shuffle` on by default and already names THAT pair as a blocker, so
 * a second ordered pair here would deepen the hole that issue has to dig out
 * of.  Measured both ways: with the `afterEach` below these pass at seeds 909,
 * 1, 42 and 1234; with it deleted, one of them fails at every one of those
 * seeds.
 */
describe("Tier-1 guard release between tests", () => {
  afterEach(() => {
    // The line under test.  Every suite in the repo that stubs a global calls
    // this; `services/app.test.ts` was the first (#934).
    vi.unstubAllGlobals();
  });

  it.each([1, 2])(
    "has the guard back at entry, whatever ran before it (%i)",
    async () => {
      // The assertion that goes red when the release is dropped: the sibling
      // test displaced the guard too, so reaching this line with a live guard
      // is only possible if something put it back in between.
      expect(() => fetch("http://127.0.0.1:9222/json/list")).toThrow(
        "http://127.0.0.1:9222/json/list",
      );
      expect(guard().drain()).toHaveLength(1);

      // Displace it exactly as `cdp/discovery.test.ts` and
      // `utils/cdp-port.test.ts` do, so this test actually leaves a stub behind
      // for the `afterEach` to clear rather than asserting into an empty room.
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
      await expect(fetch("http://127.0.0.1:9222/json/list")).resolves.toEqual({
        ok: true,
      });
      // Nothing recorded — the guard is genuinely gone, not merely quiet.
      expect(guard().drain()).toHaveLength(0);
    },
  );
});
