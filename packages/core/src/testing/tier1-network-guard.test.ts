// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

/**
 * The guard in `vitest.setup.ts` is what stops a Tier-1 suite depending on
 * machine state (#909).  Nothing else would notice if its `setupFiles` entry
 * were dropped from `vitest.config.ts`, or if the config stopped resolving
 * from a package directory — the suite would simply go quiet, which is the
 * shape of the original bug one level up.  This file is that notice.
 *
 * It asserts the guard is *installed*, deliberately without calling it: a
 * blocked call is recorded and re-raised by the guard's own `afterEach`, so a
 * test that invoked it would fail itself.  The blocking behaviour is covered
 * by the guard's failure modes in practice, and by the `*.integration.test.ts`
 * sibling for the exemption.
 *
 * The check is on the function *name*, not on `[native code]`: Node's `fetch`
 * and `WebSocket` both come from undici and are ordinary JavaScript functions,
 * so a native-code test would pass whether or not the guard was installed.
 */
describe("Tier-1 network guard", () => {
  it("replaces globalThis.fetch", () => {
    expect(globalThis.fetch.name).toBe("guardedFetch");
  });

  it("replaces globalThis.WebSocket", () => {
    expect(globalThis.WebSocket.name).toBe("GuardedWebSocket");
  });
});
