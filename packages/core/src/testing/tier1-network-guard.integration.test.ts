// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

/**
 * The Tier-1 network guard (#909) must stay off in Tier 2, which genuinely
 * needs the network: `launchChromium()` reaches real Chromium through
 * `discoverTargets()`, which issues a live `fetch`.
 *
 * Were the exemption to break, every integration suite would fail at once on
 * an error about unit tests — this names the reason directly instead, so the
 * cause is one assertion rather than an inference over seventeen files.
 */
describe("Tier-1 network guard — Tier-2 exemption", () => {
  it("leaves globalThis.fetch alone in *.integration.test.ts", () => {
    expect(globalThis.fetch.name).not.toBe("guardedFetch");
  });

  it("leaves globalThis.WebSocket alone in *.integration.test.ts", () => {
    expect(globalThis.WebSocket.name).not.toBe("GuardedWebSocket");
  });
});
