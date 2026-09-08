// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import * as selectorsModule from "./selectors.js";

const { SELECTORS } = selectorsModule;

/**
 * Tier-1 structural gate over the {@link SELECTORS} aggregate.
 *
 * These assertions have no live-DOM dependency, so this is their home —
 * not `packages/e2e/src/selectors.e2e.test.ts`, which is Tier 3 (never run
 * in CI, needs a paid LinkedHelper install).  That suite previously carried
 * a hand-maintained `expectedKeys` array covering 10 of the aggregate's 16
 * entries; because it was a subset check, the six added since drifted out
 * of coverage without anything going red (lhremote#856).
 *
 * Every assertion below is derived from the aggregate itself, so an entry
 * added tomorrow is covered the day it lands.  Liveness — "does this
 * selector still match anything on the real page" — is inherently Tier 3
 * and stays in the e2e suite.
 */
describe("SELECTORS registry", () => {
  const entries = Object.entries(SELECTORS);

  it("is non-empty", () => {
    // Guards the derived cases below: over an empty aggregate every
    // `it.each` would pass vacuously, reporting a green that evaluated
    // nothing.
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("%s is a non-empty string", (_name, value) => {
    expect(typeof value).toBe("string");
    expect(value.length).toBeGreaterThan(0);
  });

  it.each(entries)(
    "%s holds the module constant of the same name",
    (name, value) => {
      // The aggregate is documented as "keyed by name".  Shorthand property
      // syntax makes that true today; this pins it against a future edit to
      // explicit `KEY: OTHER_CONSTANT` form, which would silently make the
      // aggregate lie about what it holds.
      const moduleExports = new Map<string, unknown>(
        Object.entries(selectorsModule),
      );
      expect(moduleExports.get(name)).toBe(value);
    },
  );
});
