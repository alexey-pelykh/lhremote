// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Tier-1 unit-test guard: no live network.
 *
 * ADR-004 gives Tier 1 an external-dependency column reading `None`, but
 * nothing enforced it.  `packages/core/src/services/instance-context.test.ts`
 * consequently issued a real `fetch` to `http://127.0.0.1:9222/json/list` —
 * `DEFAULT_CDP_PORT` — through an unmocked `isCdpPort()`, so the suite passed
 * or failed on whether LinkedHelper happened to be listening on the
 * developer's machine.  CI never caught it, because nothing answers on 9222
 * there and the false branch was always taken.  That cost two bug reports
 * (#846, #848), one of which misattributed the flake to the Node major
 * version.  PR #905 fixed the one offending file; this file closes the class
 * (#909).
 *
 * Wired in via `setupFiles` in `vitest.config.ts`, which every package picks
 * up — each package runs a bare `vitest run`, and vitest resolves the config
 * from the workspace root.
 *
 * Two properties are worth stating, because neither is obvious and both are
 * load-bearing:
 *
 * 1. **Throwing is not enough on its own.**  The call site that started this,
 *    `isCdpPort()`, wraps its `fetch` in `catch { return false; }`, and
 *    `discoverTargets()` rethrows as a `CDPConnectionError`.  A guard that
 *    only threw would be swallowed at both, and the test would go on passing
 *    — deterministically now, but still passing, which is not what the
 *    acceptance criterion asks for.  So every blocked call is also *recorded*,
 *    and an `afterEach` hook fails the test on any recording that survived.
 *    A swallowed violation is still a failed test, and the message names the
 *    call either way.
 *
 * 2. **The globals are replaced by plain assignment, not `vi.stubGlobal()`.**
 *    259 unit files call `vi.restoreAllMocks()` and 225 call
 *    `vi.clearAllMocks()`; a guard installed as a spy or a stub would be torn
 *    down by the first such call and silently absent for the rest of the file.
 *    Plain assignment survives both.  A test that legitimately stubs `fetch`
 *    itself — seven do — still works: `vi.stubGlobal()` saves this guard as
 *    the original and `vi.unstubAllGlobals()` puts it back.
 *
 * Tier 2 is exempt: `*.integration.test.ts` genuinely needs the network, since
 * `launchChromium()` reaches real Chromium through `discoverTargets()`.  The
 * exemption is therefore a requirement, not a convenience.
 */

import { afterEach, expect } from "vitest";

/** Tier-2 suffix, per ADR-004's file-naming convention. */
const INTEGRATION_SUFFIX = ".integration.test.ts";

/**
 * Network calls this file blocked, drained by the `afterEach` assertion.
 *
 * Module scope is per test file: vitest evaluates setup files once per test
 * file, so no state crosses a file boundary.
 */
const blocked: string[] = [];

/**
 * Describe a `fetch()` target for the failure message.
 *
 * Naming the call is the point — the acceptance criterion asks for a failure
 * that identifies the offending request, not merely a failure.
 */
function describeFetchTarget(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  if (typeof input === "object" && input !== null && "url" in input) {
    return String((input as { url: unknown }).url);
  }
  return "<unknown target>";
}

/**
 * Record a blocked call and build the error thrown at its call site.
 */
function blockCall(call: string): Error {
  blocked.push(call);
  return new Error(
    `Tier-1 unit test attempted a real network request: ${call}. ` +
      `Unit tests must not depend on machine state — ADR-004 gives Tier 1 ` +
      `external dependencies "None". Mock the collaborator that issues this ` +
      `call, or rename the file to *.integration.test.ts if it genuinely ` +
      `needs the network.`,
  );
}

/**
 * Whether this test file is exempt.
 *
 * An unavailable `testPath` installs the guard rather than skipping it: a
 * false positive here is a loud failure on a Tier-2 file, while a false
 * negative is the silent hole this file exists to close.
 */
function isTier2(): boolean {
  const testPath = expect.getState().testPath;
  return typeof testPath === "string" && testPath.endsWith(INTEGRATION_SUFFIX);
}

if (!isTier2()) {
  globalThis.fetch = function guardedFetch(input: unknown): never {
    throw blockCall(`fetch → ${describeFetchTarget(input)}`);
  } as unknown as typeof fetch;

  globalThis.WebSocket = class GuardedWebSocket {
    constructor(url: string | URL) {
      throw blockCall(`new WebSocket → ${String(url)}`);
    }
  } as unknown as typeof WebSocket;

  afterEach(() => {
    if (blocked.length === 0) {
      return;
    }
    // Drain, so one violation fails exactly one test rather than every
    // test after it.
    const calls = blocked.splice(0, blocked.length);
    throw new Error(
      `Tier-1 unit test attempted ${String(calls.length)} real network ` +
        `request(s), each blocked: ${calls.join("; ")}. Unit tests must not ` +
        `depend on machine state — ADR-004 gives Tier 1 external dependencies ` +
        `"None". This hook reports what the guard blocked during the test; if ` +
        `the test body itself passed, the call site swallowed the error thrown ` +
        `there. Mock the collaborator that issues the call, or rename the file ` +
        `to *.integration.test.ts if it genuinely needs the network.`,
    );
  });
}
