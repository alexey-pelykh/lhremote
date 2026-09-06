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
