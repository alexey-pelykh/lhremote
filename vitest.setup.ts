// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Tier-1 unit-test guards: no live network, and no diagnostic capture.
 *
 * ADR-004 gives Tier 1 an external-dependency column reading `None`, but
 * nothing enforced it.  This file enforces two of the ways a unit run could
 * reach outside itself.  Both shipped as real defects first, and they share a
 * shape: a suite whose behaviour depended on the machine it ran on, while
 * staying green.
 *
 * **No live network (#909).**
 * `packages/core/src/services/instance-context.test.ts` issued a real `fetch`
 * to `http://127.0.0.1:9222/json/list` — `DEFAULT_CDP_PORT` — through an
 * unmocked `isCdpPort()`, so the suite passed or failed on whether
 * LinkedHelper happened to be listening on the developer's machine.  CI never
 * caught it, because nothing answers on 9222 there and the false branch was
 * always taken.  PR #905 fixed the one offending file; the guard below closes
 * the class.
 *
 * **No diagnostic capture (#925).**  The failure-diagnostic captures self-gate
 * on `LHREMOTE_CAPTURE_DIAGNOSTICS`, and `diagnosticCaptureEnabled()` in
 * `packages/core/src/cdp/wait-for-post-load.ts` reads it *per call* rather
 * than at module load.  A Tier-1 suite that drives an operation into a capture
 * while mocking neither `node:fs/promises` nor that variable therefore takes
 * the real `mkdtemp` + `writeFile` path whenever the launching shell exported
 * it — writing a real `lhremote-diagnostics-*` bundle out of a green unit run.
 * `packages/core/src/operations/get-post-engagers.test.ts` did exactly that,
 * measured.  Three suites had already grown the same delete-and-restore guard
 * by hand; the pin below closes that class too.  The artifacts hold LinkedIn
 * page content, i.e. personal data, which is why the capture is gated
 * default-off to begin with.
 *
 * Wired in via `setupFiles` in `vitest.config.ts`, which every package picks
 * up — each package runs a bare `vitest run`, and vitest walks up from the
 * package directory to the workspace-root config.
 *
 * Four properties of the network guard are worth stating, because none is
 * obvious and all are load-bearing:
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
 * The capture pin has four of its own, and each closes a different leak:
 *
 * 1. **The ambient value is captured at module scope and deleted right there**
 *    — at setup-file evaluation time, which is before the test file's own
 *    module is evaluated.  Deleting in a hook alone would be too late for a
 *    file that reads the variable at ITS module scope, and two already do
 *    (`search-posts.test.ts` and `search-posts-diagnostics.test.ts`, each
 *    snapshotting it into a module-level `const`).  They now snapshot the
 *    pinned-off state, which is the state they want.
 *
 * 2. **`beforeEach` re-pins.**  A test that sets the variable and fails to
 *    restore it would otherwise leave every later test in the same file
 *    writing real bundles.  The re-pin bounds that leak to the one test that
 *    caused it.
 *
 * 3. **`afterAll` restores the ambient value, including the "unset" case** —
 *    `undefined` becomes a `delete`, not the string `"undefined"`.  Be precise
 *    about what this is FOR, because the obvious justification is wrong:
 *    `isolate` defaults to `true` and `vitest.config.ts` does not override it,
 *    so each test file gets its own runner which is stopped afterwards, and
 *    every runner's environment is built fresh from the parent process's —
 *    which nothing here ever mutates.  The ambient value therefore cannot be
 *    lost across files today, and this restore is INERT.  It becomes live
 *    under `isolate: false` / `--no-isolate`, where runners are shared and a
 *    Tier-2 file could inherit a deleted variable from a Tier-1 one and
 *    silently lose an operator's opt-in.  It carries one cost worth naming: it
 *    re-opens the capture gate at file teardown, so asynchronous work escaping
 *    the file and settling before the runner stops could still reach a capture
 *    site.  That window is narrower than the pre-existing per-suite guards',
 *    which restore in `afterEach` — i.e. between every test — so it is a
 *    stated limit rather than a regression, but it is not zero.
 *
 * 4. **It does not clobber a deliberate opt-in.**  The reason is NOT that
 *    `before*` hooks run in registration order under `"stack"`, which would
 *    only settle hooks registered at the same level.  It is that
 *    `callSuiteHook` recurses into the PARENT suite first for `beforeEach`,
 *    and `beforeEach` is not among the hooks `"stack"` reverses.  Setup files
 *    are imported before the spec module is collected, so this file's
 *    `beforeEach` lands on the ROOT suite and runs before any `describe`-level
 *    one, at any nesting depth and whatever the registration order.  That
 *    distinction is load-bearing: three opt-ins in the repo are `describe`-level
 *    `beforeEach` hooks rather than in-test assignments
 *    (`wait-for-post-load.test.ts` twice, `wait-for-reactions-modal.test.ts`
 *    once), and under the registration-order reading they would look broken.
 *    What WOULD be clobbered is an opt-in running before this file's
 *    `beforeEach` at all — a `beforeAll`, or a SET at the test file's own
 *    module scope.  No Tier-1 suite in the repo registers a `beforeAll`, and
 *    the two files that touch this variable at module scope only READ it, so
 *    the boundary is real and currently unhit.  A future opt-in of either shape
 *    is the case to watch.
 *
 * Properties 2 and 4 both presuppose that tests run SEQUENTIALLY, which is the
 * default and which nothing here overrides.  Under `it.concurrent` /
 * `describe.concurrent` vitest runs siblings through `Promise.all`, each with
 * its own `beforeEach` chain, against a process-global `process.env` — so a
 * re-pin can fire while another test's body is suspended, and neither "the
 * opt-in wins" nor "the leak is bounded to the test that caused it" survives.
 * There are no concurrent tests in the repo today; adding one invalidates both
 * properties rather than merely straining them.
 *
 * Scope, stated rather than implied.  The network guard covers `fetch` and
 * `WebSocket`, which are the only network primitives this codebase uses (four
 * `fetch` call sites, one `new WebSocket`).  A unit test reaching `node:http`,
 * `node:net` or a raw socket is **not** caught.  Nor is non-network machine
 * state such as the `ps-list` / `pid-port` process probes, which unit tests
 * mock today.  The capture pin covers exactly one variable,
 * `LHREMOTE_CAPTURE_DIAGNOSTICS`; a suite that reaches the filesystem by some
 * other route is not caught either, and mocking `node:fs/promises` remains how
 * a suite that genuinely grades the capture path does it.
 *
 * Tiers 2 and 3 are exempt from both, and for the pin that exemption is
 * deliberate rather than incidental.  `*.integration.test.ts` genuinely needs
 * the network, since `launchChromium()` reaches real Chromium through
 * `discoverTargets()`, and `*.e2e.test.ts` drives the real application.  Tier
 * 2 keeps whatever `LHREMOTE_CAPTURE_DIAGNOSTICS` the shell gave it — its
 * dependency column is the Chromium binary, not `None`, and a Tier-2 run under
 * an operator's own export is that operator's opt-in.  Tier 3 keeps it too:
 * `vitest.e2e.config.ts` declares no `setupFiles` at all, so nothing here ever
 * loads for E2E and its deliberate `env: { LHREMOTE_CAPTURE_DIAGNOSTICS: "1" }`
 * is untouched by this file.
 *
 * This file sits outside every static gate — each package lints only `eslint
 * src/`, and no tsconfig includes the repo root — so it is neither linted nor
 * type-checked.  Keep it conservative.
 */

import { afterAll, afterEach, beforeEach, expect } from "vitest";

/** Suffixes of the tiers that are allowed to reach the network. */
const NETWORK_TIER_SUFFIXES = [".integration.test.ts", ".e2e.test.ts"];

/** Global handle exposing the recorder to the guard's own tests. */
const TEST_HANDLE = "__tier1NetworkGuard";

/** Global handle exposing the capture pin to the guard's own tests. */
const CAPTURE_TEST_HANDLE = "__tier1CaptureDiagnosticsGuard";

/** The diagnostic-capture opt-in the capture sites self-gate on. */
const CAPTURE_DIAGNOSTICS_ENV = "LHREMOTE_CAPTURE_DIAGNOSTICS";

/**
 * The ambient `LHREMOTE_CAPTURE_DIAGNOSTICS`, read ONCE here.
 *
 * Setup files are evaluated per test file and before that file's own module,
 * so this is the value the launching shell gave the worker, taken before any
 * test could touch it.  `afterAll` hands exactly this back.
 */
const ambientCaptureDiagnostics = process.env[CAPTURE_DIAGNOSTICS_ENV];

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

/** Pin the capture gate OFF for a test that has not asked for it. */
function pinCaptureDiagnosticsOff(): void {
  delete process.env[CAPTURE_DIAGNOSTICS_ENV];
}

/** Hand the shell back exactly the value it had, including "unset". */
function restoreAmbientCaptureDiagnostics(): void {
  if (ambientCaptureDiagnostics === undefined) {
    delete process.env[CAPTURE_DIAGNOSTICS_ENV];
  } else {
    process.env[CAPTURE_DIAGNOSTICS_ENV] = ambientCaptureDiagnostics;
  }
}

/**
 * Whether this test file is allowed to reach the network.
 *
 * An unavailable `testPath` installs the guard rather than skipping it: a
 * false positive is a loud failure on a Tier-2 file, while a false negative is
 * the silent hole this file exists to close.
 *
 * That trade is stated for the NETWORK guard and does not carry to the capture
 * pin, which now shares this predicate.  A network guard installed on a Tier-2
 * file throws and names the call; a pin installed there only deletes an
 * environment variable — nothing throws, nothing asserts on it, and the Tier-2
 * exemption two paragraphs up, which is deliberate, is revoked in silence.  So
 * on this branch one property fails loudly and the other fails quietly.  The
 * branch is unreachable under `vitest run`, where `testPath` is always a
 * string; if that ever stops holding, the pin wants its own predicate.
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

  // Pin the diagnostic capture OFF for the rest of this file (#925).  Done
  // here rather than only in `beforeEach` because a test file that reads the
  // variable at its own module scope is evaluated after this file and before
  // any hook runs — it must already see the pinned state.
  pinCaptureDiagnosticsOff();

  // Exposed so the per-package canaries can observe that the pin reached them.
  // It carries the ambient value rather than merely existing: in CI nobody
  // exports the variable, so `expect(process.env.LHREMOTE_CAPTURE_DIAGNOSTICS)
  // .toBeUndefined()` passes there whether or not this file ran at all, and a
  // canary that cannot fail is not a canary.  Test-only; nothing in packages/
  // reads it.
  (globalThis as Record<string, unknown>)[CAPTURE_TEST_HANDLE] = {
    ambient: ambientCaptureDiagnostics,
  };

  // Re-pin before every test, so a test that sets the variable and does not
  // restore it cannot leak into the ones that follow it in this file.  Under
  // the default `sequence.hooks: "stack"` this runs BEFORE any file-level
  // `beforeEach`, so a deliberate opt-in still wins.
  beforeEach(pinCaptureDiagnosticsOff);

  afterEach(drain);
  afterAll(drain);

  // Registered last, so under `"stack"`'s reverse ordering it runs before the
  // drain above — the worker is reused across files, and a Tier-2 file that
  // inherited a deleted variable would silently lose an operator's opt-in.
  afterAll(restoreAmbientCaptureDiagnostics);
}
