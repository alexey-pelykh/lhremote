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
 * **What this replacement does and does not do.**  Every case below is
 * derived from the aggregate, so all 16 entries are checked and a 17th is
 * checked the day it is added to `SELECTORS` — no list to remember.  That
 * is a trade, not a strict widening: a subset check fails when a named key
 * is REMOVED, and a derived one cannot, because a removed entry is simply
 * one fewer case.
 *
 * Removal detection is deliberately not restored here.  Catching it needs
 * an expectation from outside the aggregate, and every such expectation is
 * a hand-maintained list — the thing that drifted.  The one form that would
 * catch both directions without a list is module-to-aggregate parity, and
 * it fails today: `POST_DETAIL_CONTAINER`, `POST_DETAIL_SDUI_SCREEN`,
 * `POST_DETAIL_BODY_TEXT_LEAF`, `POST_DETAIL_BODY_COMMENTARY_WRAPPER`,
 * `POST_REACTIONS_MENU` and `COMMENT_ARTICLE_ANY` are exported selectors
 * that are not in `SELECTORS`, despite its docstring saying "all
 * selectors".  Closing that is its own change, not lhremote#856's.
 *
 * Liveness — "does this selector still match anything on the real page" —
 * is inherently Tier 3 and stays in the e2e suite.
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
      // aggregate lie about what it holds.  It compares by VALUE, so it is
      // blind to an alias onto a constant that happens to carry the same
      // string — `COMMENT_REACTIONS_MENU` and `POST_REACTIONS_MENU` are
      // byte-identical today, and swapping one for the other would pass.
      const moduleExports = new Map<string, unknown>(
        Object.entries(selectorsModule),
      );
      expect(moduleExports.get(name)).toBe(value);
    },
  );
});
