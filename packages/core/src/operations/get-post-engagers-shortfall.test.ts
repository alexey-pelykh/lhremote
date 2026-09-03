// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// The UNDER-COLLECTION contract on `getPostEngagers` (#874).
//
// Kept out of `get-post-engagers.test.ts` for the reason that file states in
// its own header: it carries the #827 extraction-contract oracle and is
// executor-uneditable by construction. That is not merely a process rule here,
// it is the substance of this fix. The oracle's "stops scrolling when modal is
// at bottom" case REQUIRES one engager against `totalReactions: 5` to return
// normally, which is precisely why the repair reports rather than raises — the
// two candidate raises (widening the empty gate to `extractedCount < cardinal`,
// or re-reading once after a declined scroll) both turn that test red.
//
// So this suite pins the OTHER half of the same behaviour: the call still
// returns, and it no longer returns silently.
//
// The paired constraint, stated as it governs every case below:
//   - nothing that used to return may start throwing (legal-empty and
//     legal-short false positives at zero), and
//   - nothing that ends short of both the request and the modal's own count
//     may return without saying so (silent under-collection at zero).
// Cases satisfying only one of those are the failure this suite exists to
// catch, so the legal outcomes are pinned here alongside the defect.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("./navigate-away.js", () => ({
  navigateAwayIf: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
  gaussianBetween: vi.fn().mockReturnValue(500),
  maybeHesitate: vi.fn().mockResolvedValue(undefined),
  maybeBreak: vi.fn().mockResolvedValue(undefined),
  simulateReadingTime: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../linkedin/dom-automation.js", () => ({
  humanizedScrollTo: vi.fn().mockResolvedValue(undefined),
  humanizedClick: vi.fn().mockResolvedValue(undefined),
}));

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import { getPostEngagers } from "./get-post-engagers.js";

/** One engager row. Identity never matters here; only how many arrive does. */
function rows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_unused, index) => ({
    firstName: `First${String(index)}`,
    lastName: `Last${String(index)}`,
    publicId: `person-${String(index)}`,
    headline: null,
    engagementType: "LIKE",
  }));
}

describe("getPostEngagers under-collection reporting (#874)", () => {
  const CDP_PORT = 9222;
  const POST_URL =
    "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/";

  /**
   * Prime the positional `evaluate` queue for one run.
   *
   * The operation's evaluate order is: post readiness, find trigger, modal
   * readiness, modal total, then the collect loop's scrape/scroll pairs.
   *
   * @param opts.afterTotal - The collect-loop reads, flat and verbatim. Flat
   *   rather than a scrape/scroll interleave because the settle-and-retry
   *   re-reads land BETWEEN a scrape and its scroll, and only when the scrape
   *   was empty against a positive cardinal — an interleaving helper would have
   *   to re-implement that gate to place them, which is the operation's own
   *   logic restated in the fixture that tests it.
   */
  function setupMocks(opts: {
    totalReactions: number;
    afterTotal: unknown[];
    reactionsFound?: boolean;
  }) {
    const { totalReactions, afterTotal, reactionsFound = true } = opts;

    vi.mocked(discoverTargets).mockResolvedValue([
      {
        id: "target-1",
        type: "page",
        title: "LinkedIn",
        url: "https://www.linkedin.com/feed/",
        description: "",
        devtoolsFrontendUrl: "",
      },
    ]);

    const evaluateMock = vi.fn();
    evaluateMock.mockResolvedValueOnce(true); // post readiness
    evaluateMock.mockResolvedValueOnce(reactionsFound); // find trigger
    if (reactionsFound) {
      evaluateMock.mockResolvedValueOnce(true); // modal readiness
      evaluateMock.mockResolvedValueOnce(totalReactions);
      for (const value of afterTotal) {
        evaluateMock.mockResolvedValueOnce(value);
      }
    }

    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        navigate: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateMock,
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as CDPClient;
    });

    return { evaluateMock };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── The defect, reproduced exactly as #874 states it ────────────────────

  // The reported scenario, number for number: a 50-reaction post whose modal
  // readiness goes green mid-hydration, whose first scrape sees 3 rows, and
  // whose 3-row list does not overflow its pane — so the scroll source finds no
  // scrollable region, its `scrollTop` write is a no-op, and it reports
  // `false`. Before this fix the call returned those 3 rows beside
  // `paging.total: 50` with nothing to distinguish it from a correct read.
  it("reports the shortfall when a mid-hydration scrape cannot scroll its way out", async () => {
    setupMocks({
      totalReactions: 50,
      afterTotal: [rows(3), false],
    });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.engagers).toHaveLength(3);
    expect(result.paging).toEqual({ start: 0, count: 3, total: 50 });
    expect(result.shortfall).toEqual({
      collected: 3,
      requested: 20,
      cardinal: 50,
      stoppedBecause: "scroll-declined",
    });
  });

  // The same fixture the uneditable oracle pins for "returns normally", asserted
  // here for what it must now ALSO do. Both halves are the contract: the oracle
  // owns the no-throw, this owns the no-silence, and a repair that raised would
  // satisfy this file while turning that one red.
  it("still returns, rather than raising, on the fixture the oracle pins", async () => {
    setupMocks({
      totalReactions: 5,
      afterTotal: [rows(1), true, rows(1), false],
    });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      count: 5,
    });

    expect(result.engagers).toHaveLength(1);
    expect(result.shortfall).toEqual({
      collected: 1,
      requested: 5,
      cardinal: 5,
      stoppedBecause: "scroll-declined",
    });
  });

  // The other exhausted exit, and the one that is a limit of this code rather
  // than of the page: 21 scrapes and 20 scrolls that all succeed while the row
  // count never reaches the request. Distinguishing it matters because the
  // caller's remedy differs — ask for fewer rows, rather than conclude the
  // modal had no more to give.
  it("names the scroll budget when the loop runs out of attempts", async () => {
    const stuck = rows(4);
    const afterTotal: unknown[] = [];
    for (let attempt = 0; attempt <= 20; attempt++) {
      afterTotal.push(stuck);
      if (attempt < 20) afterTotal.push(true);
    }

    setupMocks({ totalReactions: 900, afterTotal });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      count: 500,
    });

    expect(result.shortfall).toEqual({
      collected: 4,
      requested: 500,
      cardinal: 900,
      stoppedBecause: "scroll-budget-exhausted",
    });
  });

  // `collected` is the pre-slice figure and `paging.count` is the post-slice
  // one. They are different numbers whenever `start` skips rows that were in
  // fact collected, and reporting the window size as the collection size would
  // understate what the scrape actually read.
  it("reports rows collected, not rows returned, when a start offset applies", async () => {
    setupMocks({
      totalReactions: 50,
      afterTotal: [rows(3), false],
    });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      start: 1,
      count: 20,
    });

    expect(result.paging.count).toBe(2);
    expect(result.shortfall?.collected).toBe(3);
    expect(result.shortfall?.requested).toBe(21);
  });

  // The settle-and-retry (#840) fires only on an EMPTY contradicted scrape, so
  // a re-read that lands short leaves the collection in exactly the state this
  // fix reports on. Pins the two mechanisms composing rather than one masking
  // the other.
  it("reports a shortfall that the empty-scrape settle recovered only partway", async () => {
    setupMocks({
      totalReactions: 40,
      // scrape (empty) → settle re-read (empty) → settle re-read (3 rows,
      // budget spent) → scroll declines.
      afterTotal: [[], [], rows(3), false],
    });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.engagers).toHaveLength(3);
    expect(result.shortfall).toEqual({
      collected: 3,
      requested: 20,
      cardinal: 40,
      stoppedBecause: "scroll-declined",
    });
  });

  // ─── Legal outcomes: the false-positive side of the paired constraint ────

  // The case the whole empty-vs-error contract exists to keep working. A post
  // nobody reacted to is not short of anything.
  it("reports no shortfall for a genuinely zero-reaction post", async () => {
    setupMocks({ totalReactions: 0, afterTotal: [[], false] });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.engagers).toEqual([]);
    expect(result.shortfall).toBeNull();
  });

  // The discriminator is CONTRADICTION against the page's own count, never list
  // length. Two rows against a cardinal of two is a complete read that happens
  // to be shorter than the caller's window, and flagging it would fire on every
  // small post.
  it("reports no shortfall for a short list that matches its cardinal", async () => {
    setupMocks({ totalReactions: 2, afterTotal: [rows(2), false] });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      count: 20,
    });

    expect(result.engagers).toHaveLength(2);
    expect(result.paging.total).toBe(2);
    expect(result.shortfall).toBeNull();
  });

  // Ordinary pagination, and the false positive that would make the signal
  // worth ignoring: asking for 5 of 227 and getting 5 is a complete answer to
  // the question asked. `paging.total` already reports that more exist.
  it("reports no shortfall when the requested window was satisfied", async () => {
    setupMocks({ totalReactions: 227, afterTotal: [rows(5)] });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      count: 5,
    });

    expect(result.engagers).toHaveLength(5);
    expect(result.paging.total).toBe(227);
    expect(result.shortfall).toBeNull();
  });

  // A `start` past the end of a complete scrape yields an empty window, and
  // that is the caller's offset rather than a failed or partial collection —
  // the same distinction the oracle pins for the raise.
  it("reports no shortfall for an empty window past the end of a complete scrape", async () => {
    setupMocks({ totalReactions: 2, afterTotal: [rows(2), false] });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      start: 5,
      count: 10,
    });

    expect(result.engagers).toEqual([]);
    expect(result.shortfall).toBeNull();
  });

  // An unusable cardinal is a broken count somewhere upstream, not a shortfall
  // to report. `NaN` is the value that discriminates the predicate's
  // `cardinal > extractedCount` spelling from a `!(cardinal <= extractedCount)`
  // one that reads as its equivalent: the latter would manufacture a shortfall
  // against a count that was never read.
  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
  ])("reports no shortfall against a %s cardinal", async (_label, cardinal) => {
    setupMocks({ totalReactions: cardinal, afterTotal: [rows(3), false] });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.engagers).toHaveLength(3);
    expect(result.shortfall).toBeNull();
  });

  // The no-trigger early return never opens a modal and never reads a cardinal.
  // Its `total: 0` is a substitute, not an observation, so there is nothing for
  // a collection to fall short OF.
  // The other path that reaches `null` without ever reading a cardinal, and the
  // one no earlier case covered: the modal opened, but its own count came back
  // unreadable, so `total` falls back to `0`. Zero contradicts no row count, so
  // nothing fires — correctly, since the discriminator is a contradiction
  // against a rendered cardinal and here nothing was rendered to contradict.
  //
  // What this kills: a predicate that drops the cardinal term and fires on the
  // request shortfall alone (3 of 20 requested) — the NFR-3 false positive, on
  // the path where there is least to go on.
  //
  // What it CANNOT kill, stated so the green is not read as wider than it is: a
  // predicate that consults `paging.total` instead of the raw cardinal. The
  // fallback IS the row count here, so it corroborates itself — `3 > 3` is
  // false and the outcome is identical. That substitution is unobservable from
  // any fixture on this path, which is the reason the raw `total` is passed to
  // the predicate rather than the already-defaulted `paging.total`, and the
  // reason that choice is recorded in prose at the call site instead of being
  // left to a test to defend.
  it("reports no shortfall when the modal's own count is unreadable", async () => {
    setupMocks({ totalReactions: 0, afterTotal: [rows(3), false] });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      count: 20,
    });

    expect(result.engagers).toHaveLength(3);
    // The fallback, and the reason it cannot corroborate itself: `paging.total`
    // is the row count, not a cardinal the page rendered.
    expect(result.paging.total).toBe(3);
    expect(result.shortfall).toBeNull();
  });

  it("reports no shortfall when no reactions trigger was found", async () => {
    setupMocks({ totalReactions: 0, afterTotal: [], reactionsFound: false });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.engagers).toEqual([]);
    expect(result.paging).toEqual({ start: 0, count: 0, total: 0 });
    expect(result.shortfall).toBeNull();
  });

  // The field is present on every result, not only on the short ones. A signal
  // that vanishes on the healthy path is one an MCP or CLI consumer reading
  // serialized JSON never learns to check for, which is the silence this fix
  // exists to end.
  it("states completeness explicitly rather than omitting the field", async () => {
    setupMocks({ totalReactions: 2, afterTotal: [rows(2), false] });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(Object.keys(result)).toContain("shortfall");
    expect(JSON.parse(JSON.stringify(result))).toHaveProperty(
      "shortfall",
      null,
    );
  });

  // Cost claim, and a hard constraint rather than an optimisation: the
  // uneditable oracle pins the success-path evaluate count at 7 and 6 in its
  // two polling cases, so a completeness check that spent a `Runtime.evaluate`
  // would turn those red. Every term it needs is already in hand.
  it("spends no additional page evaluate to decide completeness", async () => {
    const { evaluateMock } = setupMocks({
      totalReactions: 2,
      afterTotal: [rows(2)],
    });

    await getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT, count: 2 });

    // 1 readiness + 1 trigger + 1 modal ready + 1 total + 1 scrape = 5
    expect(evaluateMock).toHaveBeenCalledTimes(5);
  });
});
