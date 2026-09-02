// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { ExtractionFailedError } from "../services/errors.js";
import { assertCardinalCorroboration } from "./corroboration.js";

describe("assertCardinalCorroboration", () => {
  const OBSERVATION = {
    surface: "post-detail",
    variant: "sdui",
    field: "comments",
    cardinalName: "commentCount",
  };

  it("raises when an empty extraction is contradicted by a positive cardinal", () => {
    expect(() =>
      assertCardinalCorroboration({
        ...OBSERVATION,
        cardinal: 41,
        extractedCount: 0,
      }),
    ).toThrow(ExtractionFailedError);
  });

  it("names the surface, variant, field and cardinal in the diagnosis", () => {
    // The operator reading this line is the least able party to diagnose a
    // stale selector, so every term needed to act must be in the message.
    try {
      assertCardinalCorroboration({
        ...OBSERVATION,
        cardinal: 41,
        extractedCount: 0,
      });
      expect.unreachable("expected a contradicted empty extraction to raise");
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractionFailedError);
      const failure = error as ExtractionFailedError;
      expect(failure.surface).toBe("post-detail");
      expect(failure.variant).toBe("sdui");
      expect(failure.field).toBe("comments");
      expect(failure.corroborator).toBe("commentCount=41");
      expect(failure.message).toContain("commentCount=41");
    }
  });

  // The lower boundary, pinned explicitly. Without it a `cardinal <= 1` mutant
  // survives every other case here — and it would silently return an empty
  // list for a post whose page reports exactly one comment, which is the
  // defect class this check exists to close, just at N=1.
  it("raises at the lower boundary of a contradicting cardinal", () => {
    expect(() =>
      assertCardinalCorroboration({
        ...OBSERVATION,
        cardinal: 1,
        extractedCount: 0,
      }),
    ).toThrow(ExtractionFailedError);
  });

  // The legal outcome this whole check exists to preserve. Without it the
  // contract degenerates into always-throw-on-empty and every post with no
  // comments and every post with no reactions starts failing.
  it("returns for an empty extraction that a zero cardinal corroborates", () => {
    expect(() =>
      assertCardinalCorroboration({
        ...OBSERVATION,
        cardinal: 0,
        extractedCount: 0,
      }),
    ).not.toThrow();
  });

  it("returns for a non-empty extraction, whatever the cardinal", () => {
    expect(() =>
      assertCardinalCorroboration({
        ...OBSERVATION,
        cardinal: 41,
        extractedCount: 1,
      }),
    ).not.toThrow();
  });

  // Under-count is not a contradiction: a capped `maxComments`, an unexhausted
  // load-more loop and an un-scrolled modal all legitimately yield fewer rows
  // than the page claims. Only emptiness is corroborated.
  it("returns for a partial extraction well below the cardinal", () => {
    expect(() =>
      assertCardinalCorroboration({
        ...OBSERVATION,
        cardinal: 500,
        extractedCount: 10,
      }),
    ).not.toThrow();
  });

  // A negative or unparseable cardinal is a broken count, not a contradiction
  // to report. Raising would point an operator at this field's selectors for a
  // parsing regression that lives somewhere else entirely. `NaN` is the case
  // that discriminates the predicate's `cardinal > 0` from the `!(cardinal
  // <= 0)` spelling that reads as its equivalent — `NaN <= 0` is `false`, so
  // that form reports a contradiction and prints `commentCount=NaN`.
  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
  ])(
    "returns rather than reporting a contradiction on a %s cardinal",
    (_label, cardinal) => {
      expect(() =>
        assertCardinalCorroboration({
          ...OBSERVATION,
          cardinal,
          extractedCount: 0,
        }),
      ).not.toThrow();
    },
  );
});
