// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { ExtractionFailedError } from "../services/errors.js";
import {
  assertCardinalCorroboration,
  assertRegionCorroboration,
  contradictsCompleteCollection,
} from "./corroboration.js";

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

// The COMPLETE-vs-partial companion (#874). Tested here rather than only
// through `getPostEngagers` because the operation cannot reach every arm: its
// collect loop excludes the satisfied exit before the predicate is consulted at
// all, so the `requestedCount` guard is unobservable from that side and a
// mutant that deleted it survived the whole behavioural suite. This is the
// level where the rule is actually decidable.
describe("contradictsCompleteCollection", () => {
  it("contradicts a collection short of both the request and the cardinal", () => {
    expect(
      contradictsCompleteCollection({
        extractedCount: 3,
        requestedCount: 20,
        cardinal: 50,
      }),
    ).toBe(true);
  });

  // The false positive that would make the signal worth ignoring: ordinary
  // pagination. A caller that asks for 5 of 227 and gets 5 has a complete
  // answer to the question it asked, and `paging.total` already says more
  // exist. Without this the predicate fires on nearly every healthy paginated
  // call.
  it.each([
    ["exactly", 5],
    ["beyond", 6],
  ])(
    "returns for a collection that met the request %s",
    (_label, extractedCount) => {
      expect(
        contradictsCompleteCollection({
          extractedCount,
          requestedCount: 5,
          cardinal: 227,
        }),
      ).toBe(false);
    },
  );

  // The legal short list, and the outcome the uneditable oracle protects: the
  // page claims two and rendered two. Shorter than the caller's window, and
  // complete.
  it.each([
    ["equal to", 2],
    ["below", 1],
  ])(
    "returns for a collection matching a cardinal %s it",
    (_label, cardinal) => {
      expect(
        contradictsCompleteCollection({
          extractedCount: 2,
          requestedCount: 20,
          cardinal,
        }),
      ).toBe(false);
    },
  );

  // The lower boundary, pinned explicitly. Without it a `cardinal >
  // extractedCount + 1` mutant survives every other case here, and it would
  // stay silent about the single missing reactor — the same defect class, just
  // at a difference of one.
  it("contradicts at a cardinal exactly one above the collection", () => {
    expect(
      contradictsCompleteCollection({
        extractedCount: 2,
        requestedCount: 20,
        cardinal: 3,
      }),
    ).toBe(true);
  });

  // The other boundary: one row short of the request is still short.
  it("contradicts at one row below the request", () => {
    expect(
      contradictsCompleteCollection({
        extractedCount: 4,
        requestedCount: 5,
        cardinal: 50,
      }),
    ).toBe(true);
  });

  // The legal empty, which must stay legal here too. A post nobody reacted to
  // is not short of anything, whatever the caller asked for.
  it("returns for an empty collection a zero cardinal corroborates", () => {
    expect(
      contradictsCompleteCollection({
        extractedCount: 0,
        requestedCount: 20,
        cardinal: 0,
      }),
    ).toBe(false);
  });

  // A negative or unparseable cardinal is a broken count somewhere else, not a
  // shortfall. `NaN` discriminates the `cardinal > extractedCount` spelling
  // from the `!(cardinal <= extractedCount)` one that reads as its equivalent:
  // `NaN <= 3` is `false`, so that form would report a shortfall against a
  // count that was never read.
  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
  ])("returns rather than reporting a shortfall on a %s cardinal", (_label, cardinal) => {
    expect(
      contradictsCompleteCollection({
        extractedCount: 3,
        requestedCount: 20,
        cardinal,
      }),
    ).toBe(false);
  });
});

// The CONTAINER tier (#852). Tested here rather than only through
// `getPostStats` for the reason the collection companion above is: the
// operation reaches this predicate with a `countsRootNarrowed` the in-page
// script decided, so the false arm is only observable from that side by
// staging a whole second fixture, while the arms that discriminate a mutant —
// a negative sum, a `NaN` — are not reachable from it at all. This is the
// level where the rule is decidable.
describe("assertRegionCorroboration", () => {
  const OBSERVATION = {
    surface: "post-detail",
    variant: "legacy",
    field: "engagementCounts",
    regionName: "countsRoot",
  };

  it("raises when an empty read is contradicted by a region that rendered", () => {
    expect(() =>
      assertRegionCorroboration({
        ...OBSERVATION,
        regionResolved: true,
        extractedCount: 0,
      }),
    ).toThrow(ExtractionFailedError);
  });

  it("names the surface, variant, field and region in the diagnosis", () => {
    // Same standard the cardinal tier is held to: the operator reading this
    // line is the least able party to diagnose a stale counter pattern, so
    // every term needed to act has to be in the message.
    try {
      assertRegionCorroboration({
        ...OBSERVATION,
        regionResolved: true,
        extractedCount: 0,
      });
      expect.unreachable("expected a contradicted empty region to raise");
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractionFailedError);
      const failure = error as ExtractionFailedError;
      expect(failure.surface).toBe("post-detail");
      expect(failure.variant).toBe("legacy");
      expect(failure.field).toBe("engagementCounts");
      expect(failure.corroborator).toBe("countsRoot=rendered");
      expect(failure.message).toContain("countsRoot=rendered");
    }
  });

  // The arm that keeps this check off every ordinary post. `post-zero-comments`
  // is a captured legacy page rendering no counts row at all beside genuinely
  // zero engagement, and the `sdui` adapter declares `counts: []`, so this is
  // the only branch that dialect can ever reach.
  it("returns for an empty read whose region never resolved", () => {
    expect(() =>
      assertRegionCorroboration({
        ...OBSERVATION,
        regionResolved: false,
        extractedCount: 0,
      }),
    ).not.toThrow();
  });

  // The lower boundary, pinned explicitly: one counter reading 1 proves the
  // patterns still match this row. Without it an `extractedCount > 1` mutant
  // survives, and it would report a post carrying exactly one comment as a
  // stale-counter failure.
  it("returns at the lower boundary of a non-empty read", () => {
    expect(() =>
      assertRegionCorroboration({
        ...OBSERVATION,
        regionResolved: true,
        extractedCount: 1,
      }),
    ).not.toThrow();
  });

  it("returns for a non-empty read, whatever the region says", () => {
    for (const regionResolved of [true, false]) {
      expect(() =>
        assertRegionCorroboration({
          ...OBSERVATION,
          regionResolved,
          extractedCount: 43,
        }),
      ).not.toThrow();
    }
  });

  // A negative or unparseable sum is a broken read, not a contradiction to
  // report. `NaN` is the case that discriminates the predicate's
  // `extractedCount !== 0` from the `extractedCount > 0` spelling its sibling
  // uses: `NaN > 0` is `false`, so that form would treat a parsing regression
  // upstream as an empty read and point an operator at these counter patterns.
  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
  ])(
    "returns rather than reporting a contradiction on a %s read",
    (_label, extractedCount) => {
      expect(() =>
        assertRegionCorroboration({
          ...OBSERVATION,
          regionResolved: true,
          extractedCount,
        }),
      ).not.toThrow();
    },
  );
});
