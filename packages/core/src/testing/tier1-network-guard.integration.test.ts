// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

/**
 * The Tier-1 network guard must stay off in Tier 2, which genuinely needs the
 * network: `launchChromium()` reaches real Chromium through `discoverTargets()`,
 * which issues a live `fetch`.
 *
 * Were the exemption to break, every integration suite would fail at once on an
 * error about unit tests — this names the reason directly, so the cause is one
 * assertion rather than an inference over eighteen files.
 *
 * The `LHREMOTE_CAPTURE_DIAGNOSTICS` pin (#925) is exempt here too, and for a
 * reason of its own rather than by inheritance: ADR-004 gives Tier 1
 * `Dependency: None` while Tier 2's dependency is the Chromium binary, so a
 * Tier-2 run under an operator's own export is that operator's opt-in and the
 * pin must not take it away.
 */
describe("Tier-1 network guard — Tier-2 exemption", () => {
  it("does not install its test handle in *.integration.test.ts", () => {
    expect(
      (globalThis as { __tier1NetworkGuard?: unknown }).__tier1NetworkGuard,
    ).toBeUndefined();
  });

  it("leaves fetch and WebSocket as the runtime's own", () => {
    expect(globalThis.fetch.name).not.toBe("guardedFetch");
    expect(globalThis.WebSocket.name).not.toBe("GuardedWebSocket");
  });
});

describe("Tier-1 diagnostic-capture pin — Tier-2 exemption", () => {
  it("does not install its test handle in *.integration.test.ts", () => {
    // Symmetric with the network guard's assertion above. The variable's own
    // value is deliberately NOT asserted: Tier 2 keeps whatever the shell gave
    // it, so both `undefined` and `"1"` are correct here and only the absent
    // handle distinguishes "the pin skipped this file" from "the shell
    // happened to export nothing".
    expect(
      (globalThis as { __tier1CaptureDiagnosticsGuard?: unknown })
        .__tier1CaptureDiagnosticsGuard,
    ).toBeUndefined();
  });
});
