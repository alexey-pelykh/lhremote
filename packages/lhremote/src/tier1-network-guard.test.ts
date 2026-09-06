// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

/**
 * Per-package canary for the Tier-1 network guard in the root `vitest.setup.ts`.
 *
 * The guard is wired into the workspace-root `vitest.config.ts`, and each
 * package reaches it only because a bare `vitest run` walks up from the package
 * directory to find that config.  That walk stops at the first directory
 * holding a `vitest.config.*` **or `vite.config.*`** — so adding one to this
 * package for an unrelated reason (a path alias, a plugin, a longer timeout)
 * would silently detach the guard, and every unit file here would be back on
 * the live network with the suite still green.
 *
 * The canary therefore has to live in each package; a copy in `packages/core`
 * cannot see this one detach.  The full behavioural suite is in
 * `packages/core/src/testing/tier1-network-guard.test.ts` — this only asserts
 * the guard reached this package, and that it bites.
 */
describe("Tier-1 network guard reaches this package", () => {
  it("installs its test handle", () => {
    expect(
      (globalThis as { __tier1NetworkGuard?: unknown }).__tier1NetworkGuard,
    ).toBeDefined();
  });

  it("blocks fetch and names the target", () => {
    expect(() => fetch("http://127.0.0.1:9222/json/list")).toThrow(
      "http://127.0.0.1:9222/json/list",
    );
    // The guard records what it blocks and fails the test on anything left
    // behind, so this deliberate trip must clear its own record.
    const handle = (globalThis as { __tier1NetworkGuard?: { drain: () => string[] } })
      .__tier1NetworkGuard;
    expect(handle?.drain()).toHaveLength(1);
  });
});
