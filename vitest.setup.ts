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
 * there and the false branch was always taken.  PR #905 fixed the one
 * offending file; this file closes the class.
 *
 * Wired in via `setupFiles` in `vitest.config.ts`, which every package picks
 * up — each package runs a bare `vitest run`, and vitest walks up from the
 * package directory to the workspace-root config.
 *
 * Four properties are worth stating, because none is obvious and all are
 * load-bearing:
 *
 * 1. **Throwing is not enough on its own.**  The call site that started this,
 *    `isCdpPort()`, wraps its `fetch` in `catch { return false; }`, and
 *    `discoverTargets()` rethrows as a `CDPConnectionError`.  A guard that
 *    only threw would be swallowed at both, and the test would go on passing
 *    — deterministically now, but still passing, which is not what the
 *    acceptance criterion asks for.  So every blocked call is also *recorded*,
 *    and the drain hooks below fail the test on any recording that survived.
 *
 * 2. **`afterEach` alone is not enough either.**  A call made from the file's
 *    own `afterAll`, or by a promise settling after the last test, is blocked
 *    but would never be drained — so a swallowed one there passed silently.
 *    Both hooks drain; `afterAll` is the backstop, not a duplicate.
 *
 * 3. **The globals are replaced by plain assignment, not `vi.stubGlobal()`.**
 *    Nearly every unit file calls `vi.restoreAllMocks()`, which restores a
 *    `vi.spyOn` spy and would tear a spy-installed guard down mid-file.  Plain
 *    assignment survives it.  Tests that replace `fetch` themselves are
 *    unaffected either way: `vi.stubGlobal()` saves this guard as the original
 *    and `vi.unstubAllGlobals()` puts it back, and `vi.spyOn(globalThis,
 *    "fetch")` captures this guard and `vi.restoreAllMocks()` restores it.
 *    (A *stub*-installed guard would in fact survive `restoreAllMocks()` too —
 *    only `vi.unstubAllGlobals()` or `unstubGlobals: true` clears stubs — so
 *    the spy half alone is what makes plain assignment the right choice.)
 *
 * 4. **The drain hooks must run after the suite's own.**  Vitest's
 *    `sequence.hooks` defaults to `"stack"`, so hooks registered here — before
 *    the test file's module is evaluated — run last.  A config setting
 *    `sequence: { hooks: "list" }` would invert that and drain too early.
 *
 * Scope, stated rather than implied: this guards `fetch` and `WebSocket`,
 * which are the only network primitives this codebase uses (four `fetch` call
 * sites, one `new WebSocket`).  A unit test reaching `node:http`, `node:net`
 * or a raw socket is **not** caught.  Nor is non-network machine state such as
 * the `ps-list` / `pid-port` process probes, which unit tests mock today.
 *
 * Tiers 2 and 3 are exempt: `*.integration.test.ts` genuinely needs the
 * network, since `launchChromium()` reaches real Chromium through
 * `discoverTargets()`, and `*.e2e.test.ts` drives the real application.  The
 * exemption is a requirement, not a convenience.
 *
 * This file sits outside every static gate — each package lints only `eslint
 * src/`, and no tsconfig includes the repo root — so it is neither linted nor
 * type-checked.  Keep it conservative.
 */

import { afterAll, afterEach, expect } from "vitest";

/** Suffixes of the tiers that are allowed to reach the network. */
const NETWORK_TIER_SUFFIXES = [".integration.test.ts", ".e2e.test.ts"];

/** Global handle exposing the recorder to the guard's own tests. */
const TEST_HANDLE = "__tier1NetworkGuard";

/**
 * Network calls this file blocked, drained by the hooks below.
 *
 * Module scope is per test file under the default `isolate: true`, so no state
 * crosses a file boundary.
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
 * The first stack frame outside this file — where the call came from.
 *
 * A swallowed call is reported by a drain hook, so without this the only
 * location a developer sees is this file's own line number.
 */
function callSite(error: Error): string {
  const frame = (error.stack ?? "")
    .split("\n")
    .slice(1)
    .find(
      (line) =>
        !line.includes("vitest.setup.ts") && !line.includes("node:internal"),
    );
  return frame === undefined ? "call site unknown" : frame.trim();
}

/**
 * Record a blocked call and build the error thrown at its call site.
 */
function blockCall(call: string): Error {
  const error = new Error(
    `Tier-1 unit test attempted to reach the live network: ${call}. ` +
      `ADR-004 gives Tier 1 external dependencies "None". Mock the ` +
      `collaborator that issues this call, or rename the file to ` +
      `*.integration.test.ts if it genuinely needs the network.`,
  );
  blocked.push(`${call} (${callSite(error)})`);
  return error;
}

/**
 * Fail if anything was blocked since the last drain.
 */
function drain(): void {
  if (blocked.length === 0) {
    return;
  }
  const calls = blocked.splice(0, blocked.length);
  throw new Error(
    `Tier-1 unit test attempted to reach the live network ` +
      `${String(calls.length)} time(s), each blocked: ${calls.join("; ")}. ` +
      `ADR-004 gives Tier 1 external dependencies "None". These were recorded ` +
      `since the previous drain rather than necessarily by the test reporting ` +
      `them, so a call left running by escaped asynchronous work is ` +
      `attributed to whichever drain reaches it first; the call site beside ` +
      `each one is authoritative. If the test body itself passed, the call ` +
      `site swallowed the error thrown there.`,
  );
}

/**
 * Whether this test file is allowed to reach the network.
 *
 * An unavailable `testPath` installs the guard rather than skipping it: a
 * false positive is a loud failure on a Tier-2 file, while a false negative is
 * the silent hole this file exists to close.
 */
function isNetworkTier(): boolean {
  const testPath = expect.getState().testPath;
  return (
    typeof testPath === "string" &&
    NETWORK_TIER_SUFFIXES.some((suffix) => testPath.endsWith(suffix))
  );
}

if (!isNetworkTier()) {
  globalThis.fetch = function guardedFetch(input: unknown): never {
    throw blockCall(`fetch → ${describeFetchTarget(input)}`);
  } as unknown as typeof fetch;

  // A function rather than a class: called with `new` it still throws, and a
  // constructor-only class trips `@typescript-eslint/no-extraneous-class`
  // should this file ever come under lint.
  globalThis.WebSocket = function GuardedWebSocket(url: string | URL): never {
    throw blockCall(`new WebSocket → ${String(url)}`);
  } as unknown as typeof WebSocket;

  // Exposed so the guard's own tests can assert it blocks and names the call
  // without their recording failing them in the drain. Test-only; nothing in
  // packages/ reads it.
  (globalThis as Record<string, unknown>)[TEST_HANDLE] = {
    drain: (): string[] => blocked.splice(0, blocked.length),
  };

  afterEach(drain);
  afterAll(drain);
}
