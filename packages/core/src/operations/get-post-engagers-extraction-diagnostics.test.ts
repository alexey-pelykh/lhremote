// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// Diagnostic capture on `getPostEngagers`' EXTRACTION-failure path (#835).
//
// Sibling of `get-post-extraction-diagnostics.test.ts`, and kept out of
// `get-post-engagers.test.ts` for the same reason: that file carries the #827
// extraction-contract oracle and is executor-uneditable by construction.
//
// Same widening, same argument: `waitForReactionsModal` has already returned
// green by the time this fails — the modal opened and its container rendered —
// so a deadline-bound capture cannot see the contradiction that follows it.
//
// The header that stood here also said this bundle carries no per-adapter
// detect counts, because the reactions modal had no entry in the variant-
// adapter registry. That is false as of #840: the surface is registered, the
// probe runs, and `variantDetection` is in the bundle. It is also why the
// mock below feeds one more value than it used to — the detect probe is a
// `Runtime.evaluate` of its own, and it runs BEFORE the capture's probe
// because the same reading names the adapter in the error.

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

vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}TESTABCDEF`),
  writeFile: vi.fn().mockResolvedValue(undefined),
  lstat: vi.fn().mockResolvedValue({
    isSymbolicLink: () => false,
    isDirectory: () => true,
    mode: 0o700,
  }),
  chmod: vi.fn().mockResolvedValue(undefined),
}));

import { writeFile } from "node:fs/promises";

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import {
  adaptersFor,
  buildReactionsModalExtractionSource,
  buildReactionsModalScrollSource,
  buildReactionsModalTotalSource,
  buildReactionsTriggerSource,
} from "../linkedin/dom-variant.js";
import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
  ExtractionFailedError,
} from "../services/errors.js";

// Dynamic import after the mocks are registered, matching the convention the
// sibling capture suites document: relying on vi.mock hoisting to cover a
// module that reaches `node:fs/promises` at load time is brittle under ESM
// transforms (`wait-for-post-load.test.ts` header).
const { getPostEngagers } = await import("./get-post-engagers.js");

describe("getPostEngagers extraction-failure diagnostics (#835)", () => {
  const CDP_PORT = 9222;
  const POST_URL =
    "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/";

  /**
   * The detect probe read on the failure path.  Exactly one claimant, which is
   * what makes the raised `ExtractionFailedError` able to NAME the adapter an
   * operator has to repair rather than fall back to its placeholder.
   */
  const DETECTION = { matched: ["legacy"], probes: { sdui: 0, legacy: 1 } };

  const CAPTURE_PROBE = {
    href: POST_URL,
    dialogCount: 1,
    dialogHasInLinks: true,
    dialogChildElementCount: 4,
    bodyTextSnippet: "2 reactions\n",
    reactionsButtonAriaLabels: ["Open reactions menu"],
    reactionsCountText: "2 reactions",
    htmlDialogCount: 1,
    ariaModalCount: 1,
    hasReactionsTab: true,
    reactionsTabAncestorChain: ["div role=dialog inLinks=0"],
    resolvedModalAncestorTag: "div",
  };

  // The probe above reports an OPEN modal, and that is only honest because
  // the corroboration check runs before the Escape dispatch that dismisses it
  // (#835).  Were the capture to run after dismissal it would record
  // `dialogCount: 0` — the fingerprint of #773, a modal that never opened —
  // for a failure whose cause is the row scrape inside a modal that opened
  // fine.  `asserts the modal is still open` below pins that ordering.

  const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;

  /**
   * Drive `getPostEngagers` to the contradicted-scrape failure: the modal
   * header reports `totalReactions`, the engager scrape yields nothing.
   *
   * @param totalReactions - The cardinal the modal header reports.  `> 0`
   *   with an empty scrape is the contradiction; `0` corroborates the empty
   *   list and must stay legal.
   */
  function setupMocks(totalReactions: number) {
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
    evaluateMock.mockResolvedValueOnce(true); // reactions element found
    evaluateMock.mockResolvedValueOnce(true); // modal readiness
    evaluateMock.mockResolvedValueOnce(totalReactions);
    evaluateMock.mockResolvedValueOnce([]); // the empty scrape
    // The settle-and-retry re-reads the modal before the cardinal tier is
    // allowed to raise, because a modal still hydrating its reactor payload is
    // indistinguishable from an empty one at the container tier (#840).  It
    // sits INSIDE the collect loop, immediately after the scrape, so its
    // re-reads land here — BEFORE the scroll — and a successful one would fall
    // through to the pagination path rather than out of the collection.  Fed
    // the same empty result, so these fixtures still reach the raise they were
    // written for.
    //
    // Emitted only when the cardinal CONTRADICTS the empty scrape, because
    // that is the only case the operation spends them in: the retry is gated
    // on the contradiction, so an agreeing cardinal never enters it and a
    // positional mock that primed them anyway would feed the scroll call an
    // engager array.  That gate is the cost claim `resolves no dialect on a
    // healthy run` pins.
    if (totalReactions > 0) {
      for (let settle = 0; settle < 2; settle++) {
        evaluateMock.mockResolvedValueOnce([]); // still empty after settling
      }
    }
    // The collect loop only stops scrolling once a scroll declines: an empty
    // scrape never reaches `targetCount`, so without this the loop would eat
    // the capture's own probe as a scroll result.
    evaluateMock.mockResolvedValueOnce(false); // scroll declines
    evaluateMock.mockResolvedValueOnce(DETECTION); // per-adapter detect counts
    evaluateMock.mockResolvedValueOnce(CAPTURE_PROBE);

    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        navigate: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateMock,
        send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
      } as unknown as CDPClient;
    });

    return { evaluateMock };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv === undefined) {
      delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    } else {
      process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = originalEnv;
    }
  });

  it("writes a diagnostic bundle when the engager scrape contradicts itself", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupMocks(2);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    // The propagated error must still be the extraction contract's, not one
    // manufactured by the capture machinery — a bare `.toThrow()` would pass
    // either way.
    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(ExtractionFailedError);

    const paths = vi.mocked(writeFile).mock.calls.map((call) => String(call[0]));
    expect(paths.some((path) => path.endsWith(".json"))).toBe(true);
    // Named for the failure that actually happened: the modal readiness gate
    // went green, so `wait-for-reactions-modal` would be the wrong label.
    expect(
      paths.every((path) =>
        path.includes("reactions-modal-extraction-failure-"),
      ),
    ).toBe(true);
    warnSpy.mockRestore();
  });

  it("stamps the trigger into the bundle and the warn line", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupMocks(2);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow();

    const jsonCall = vi
      .mocked(writeFile)
      .mock.calls.find((call) => String(call[0]).endsWith(".json"));
    expect(jsonCall).toBeDefined();
    // Artifacts get copied out of their mkdtemp directory; a bundle that
    // cannot say what it was capturing leaves its reader guessing.
    expect(
      JSON.parse(String(jsonCall?.[1])) as Record<string, unknown>,
    ).toMatchObject({
      trigger: "extraction-failure",
      dialogCount: 1,
      // The field every other probe in the bundle structurally cannot supply:
      // each of those is a fixed selector, so a modal served in an unregistered
      // dialect looks exactly like one whose adapter matched and went stale.
      variantDetection: DETECTION,
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(message).toContain(String(jsonCall?.[0]).replace(/\.json$/, ""));
    expect(message).toContain("extraction-failure diagnostics");
    warnSpy.mockRestore();
  });

  it("names the dialect the detect probe resolved in the error it raises", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupMocks(2);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    // The scrape returns a bare array of rows, so the dialect cannot ride out
    // of it; it is resolved here, on the failure path, precisely because the
    // error renders as `adapter "<variant>" is partially stale — repair the
    // selectors`, and a placeholder there is not something an operator can act
    // on (#840).
    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(/adapter "legacy"/);
    warnSpy.mockRestore();
  });

  it("resolves no dialect on a healthy run, so it spends no probe there", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    // Genuinely zero reactions: the corroborator agrees, so neither the detect
    // probe nor the capture may run.  Pinning the CALL COUNT is what makes that
    // a cost claim rather than a capture claim — `writeFile` staying untouched
    // would also hold if the probe ran and only the capture was skipped.
    const { evaluateMock } = setupMocks(0);

    await getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT });

    // 1 readiness + 1 trigger + 1 modal ready + 1 total + 1 scrape + 1 scroll.
    expect(evaluateMock).toHaveBeenCalledTimes(6);
  });

  it("evaluates exactly the scripts the reactions-modal registry generates", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    // Nothing else asserts this. `dom-variant.test.ts` grades the GENERATORS
    // in isolation, and the operation suites feed a positional mock that never
    // inspects the script argument — so reverting the trigger constant to the
    // pre-#840 document-wide text-only finder leaves every test in every
    // changed file green, and #823's dominant defect returns with CI green.
    // E2E would catch it, but E2E is local-only and not run in CI per this
    // project's own CLAUDE.md.
    //
    // BYTE-IDENTICAL, like the sibling gate's pin in
    // `wait-for-reactions-modal.test.ts`: a script merely RESEMBLING the
    // generated one is the second copy ADR-008 § Decision 1 exists to prevent.
    // (That gate's readiness predicate — call 2 below — is pinned there and is
    // deliberately not re-pinned here.)
    const { evaluateMock } = setupMocks(0);

    await getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT });

    const adapters = adaptersFor("reactions-modal");
    const evaluated = evaluateMock.mock.calls.map((call) => String(call[0]));
    expect(evaluated[1]).toBe(buildReactionsTriggerSource(adapters));
    expect(evaluated[3]).toBe(buildReactionsModalTotalSource(adapters));
    expect(evaluated[4]).toBe(buildReactionsModalExtractionSource(adapters));
    // `gaussianBetween` is mocked to 500, so the randomised distance is
    // deterministic here and the scroll script is pinnable too.
    expect(evaluated[5]).toBe(buildReactionsModalScrollSource(adapters, 500));
  });

  it("re-reads a contradicted empty scrape before letting the cardinal tier raise", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    // Readiness on this surface stops at the CONTAINER tier, which is what
    // makes a genuinely-zero modal legal instead of a timeout — but it also
    // means the gate goes green while the reactor payload may still be
    // arriving. The collect loop cannot wait it out: a modal with zero rows
    // has no scrollable region, so the scroll declines on the first attempt
    // and the loop breaks after ONE scrape. Without the settle, a hydrating
    // modal raises `ExtractionFailedError` against a diagnostic bundle showing
    // a perfectly healthy open modal (#840).
    const evaluateMock = primeUpToScrape([], 2);
    evaluateMock.mockResolvedValueOnce([
      {
        firstName: "Jane",
        lastName: "Doe",
        publicId: "janedoe",
        headline: "Software Engineer at ACME",
        engagementType: "LIKE",
      },
    ]); // the payload lands on the re-read
    evaluateMock.mockResolvedValueOnce(false); // scroll declines: nothing more

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.engagers).toHaveLength(1);
    // Stopped as soon as the contradiction cleared, rather than spending its
    // whole budget: 1 readiness + 1 find + 1 modal ready + 1 total + 1 scrape
    // + 1 re-read + 1 scroll.  The re-read precedes the scroll because the
    // settle sits inside the collect loop; that ordering is what
    // `resumes pagination after a settle re-read` below is about.
    expect(evaluateMock).toHaveBeenCalledTimes(7);
  });

  it("gives up after a bounded number of re-reads and still raises", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    // The settle must not become a way for a genuinely stale adapter to
    // avoid its diagnosis. The bound is what keeps this a settle rather than
    // a retry loop.
    const evaluateMock = primeUpToScrape([], 2);
    evaluateMock.mockResolvedValueOnce([]); // still empty
    evaluateMock.mockResolvedValueOnce([]); // still empty
    evaluateMock.mockResolvedValueOnce(false); // scroll declines

    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toBeInstanceOf(ExtractionFailedError);

    // 6 as above, 2 re-reads, then the detect probe that names the adapter —
    // which runs whether or not capture is on, because it reaches the error.
    expect(evaluateMock).toHaveBeenCalledTimes(9);
  });

  /**
   * A `Runtime.evaluate` double that answers by SCRIPT IDENTITY rather than by
   * call position, modelling a modal that is still hydrating its reactor
   * payload.
   *
   * Every other fixture in this file is positional, deliberately: the pinned
   * evaluate sequence is most of what they grade.  This one cannot be.  The
   * defect under test IS an ordering, so a positional array encodes the answer
   * into the question — the two orderings consume different entries from it,
   * and whichever one it was written for is the only one that runs to
   * completion.  Modelling the PAGE instead lets both orderings run against a
   * single fixture, which is what makes the assertion falsifiable.
   *
   * Scripts are matched against the generated sources by equality — the scroll
   * one is pinnable because `gaussianBetween` is mocked to 500 — so a
   * regenerated or renamed source cannot silently re-route an answer to the
   * wrong branch.
   *
   * @param opts.total - The cardinal the modal header reports.
   * @param opts.payloads - What successive scrapes see as the list hydrates.
   *   The last entry repeats.
   */
  function hydratingModalEvaluate(opts: {
    total: number;
    payloads: readonly (readonly unknown[])[];
  }) {
    const adapters = adaptersFor("reactions-modal");
    const triggerSource = buildReactionsTriggerSource(adapters);
    const totalSource = buildReactionsModalTotalSource(adapters);
    const scrapeSource = buildReactionsModalExtractionSource(adapters);
    const scrollSource = buildReactionsModalScrollSource(adapters, 500);

    let served = 0;
    let rendered: readonly unknown[] = [];

    return vi.fn(async (script: string) => {
      if (script === triggerSource) return true;
      if (script === totalSource) return opts.total;
      if (script === scrapeSource) {
        rendered =
          opts.payloads[Math.min(served, opts.payloads.length - 1)] ?? [];
        served++;
        return rendered;
      }
      if (script === scrollSource) {
        // A modal with zero rows rendered has no scrollable region, so the
        // scroll DECLINES while the list is still empty.  That is the property
        // that makes the mis-placed settle skip pagination outright: the
        // collect loop breaks on the refusal, and a re-read that succeeds
        // afterwards has nothing left to scroll.
        return rendered.length > 0 && served < opts.payloads.length;
      }
      // Both readiness polls — post detail and the modal.
      return true;
    });
  }

  it("resumes pagination after a settle re-read, instead of shipping the partial payload", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    // The modal opened on a post with three reactions and its list is still
    // arriving: the first scrape sees nothing, the settle re-read sees one
    // row, and the rest land after a scroll.
    //
    // With the settle sitting AFTER the collect loop, the re-read's success
    // never returned to it, so this call answered with the single row the
    // re-read happened to catch — `paging.total: 3`, one engager, no scroll
    // attempted, and NO error, because the cardinal check passes the moment
    // `extractedCount > 0`.  Silent under-collection that reads as a
    // successful call, which is why the assertion is on the COUNT rather than
    // on a raise (#840).
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
    const engager = (slug: string) => ({
      firstName: "Jane",
      lastName: slug,
      publicId: slug,
      headline: "Software Engineer at ACME",
      engagementType: "LIKE",
    });
    const evaluateMock = hydratingModalEvaluate({
      total: 3,
      payloads: [
        [],
        [engager("first")],
        [engager("first"), engager("second"), engager("third")],
      ],
    });
    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        navigate: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateMock,
        send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
      } as unknown as CDPClient;
    });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    // The whole list, not the one row the settle re-read caught.
    expect(result.engagers).toHaveLength(3);
    expect(result.engagers.map((e) => e.publicId)).toEqual([
      "first",
      "second",
      "third",
    ]);
    // Pagination ran: a second scrape happened after the scroll, which is the
    // step the mis-placed settle skipped.
    const scrapeSource = buildReactionsModalExtractionSource(
      adaptersFor("reactions-modal"),
    );
    const scrapes = evaluateMock.mock.calls.filter(
      (call) => String(call[0]) === scrapeSource,
    );
    expect(scrapes).toHaveLength(3);
  });

  it("keeps the settle budget global rather than refilling it per scroll", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    // A modal that never hydrates, on a page that DOES scroll.  The settle now
    // lives inside the collect loop, so a per-iteration counter would spend
    // `EMPTY_SCRAPE_SETTLE_ATTEMPTS` re-reads on every one of the 21 scroll
    // attempts.  Hoisting the counter is what keeps this a settle rather than
    // a retry loop, and the total re-read count is the only observable that
    // says which of the two was built.
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
    const adapters = adaptersFor("reactions-modal");
    const scrapeSource = buildReactionsModalExtractionSource(adapters);
    const scrollSource = buildReactionsModalScrollSource(adapters, 500);
    const totalSource = buildReactionsModalTotalSource(adapters);
    const triggerSource = buildReactionsTriggerSource(adapters);
    // Scrolls forever and never renders a row: the collect loop runs its full
    // 21 iterations, so a per-iteration budget has 21 chances to refill.
    const evaluateMock = vi.fn(async (script: string) => {
      if (script === triggerSource) return true;
      if (script === totalSource) return 2;
      if (script === scrapeSource) return [];
      if (script === scrollSource) return true;
      return true;
    });
    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        navigate: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateMock,
        send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
      } as unknown as CDPClient;
    });

    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toBeInstanceOf(ExtractionFailedError);

    // 21 collect iterations scrape once each; the settle adds exactly
    // `EMPTY_SCRAPE_SETTLE_ATTEMPTS` re-reads across the whole collect.
    const scrapes = evaluateMock.mock.calls.filter(
      (call) => String(call[0]) === scrapeSource,
    );
    expect(scrapes).toHaveLength(21 + 2);
  });

  it("spends no re-read when the cardinal corroborates the empty scrape", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    // A post with genuinely zero reactions, and the reason the settle is
    // gated on the contradiction rather than on emptiness alone: this run and
    // the healthy one below it must cost exactly what they cost before, since
    // the success-path evaluate sequence is pinned by the uneditable oracle.
    const evaluateMock = primeUpToScrape([], 0);
    evaluateMock.mockResolvedValueOnce(false); // scroll declines

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.engagers).toEqual([]);
    expect(evaluateMock).toHaveBeenCalledTimes(6);
  });

  it("spends no re-read when the scrape returned rows", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const evaluateMock = primeUpToScrape(
      [
        {
          firstName: "Jane",
          lastName: "Doe",
          publicId: "janedoe",
          headline: "Software Engineer at ACME",
          engagementType: "LIKE",
        },
      ],
      2,
    );
    evaluateMock.mockResolvedValueOnce(false); // scroll declines

    await getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT, count: 1 });

    // Reached `targetCount` on the first scrape, so it never even scrolled.
    expect(evaluateMock).toHaveBeenCalledTimes(5);
  });

  it("is default-off: writes nothing when LHREMOTE_CAPTURE_DIAGNOSTICS is unset", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    setupMocks(2);

    // Asserted by CLASS, for the reason this file states three tests earlier:
    // the propagated error must still be the extraction contract's, and a bare
    // `.toThrow()` would pass for ANY throw at ANY point — including one that
    // never reaches the capture site this test is named for. That is not
    // academic here. `EMPTY_SCRAPE_SETTLE_ATTEMPTS` is not exported and the
    // fixture hard-codes its value as a literal `2`, so raising the constant
    // starves this positional mock and it throws somewhere else entirely —
    // green under a bare assertion while every sibling fails loudly (#840).
    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(ExtractionFailedError);

    // The bundle contains engager names and profile slugs — personal data.
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });

  it("does not capture when the scrape is not contradicted", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    // A post with genuinely zero reactions is legal and must return normally.
    // Guards against the capture degenerating into fire-on-every-empty.
    setupMocks(0);

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.engagers).toEqual([]);
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });

  it("captures while the modal is still open, before Escape dismisses it", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const { evaluateMock } = setupMocks(2);
    const sendCalls: string[] = [];
    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        navigate: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateMock,
        send: vi.fn(async (method: string) => {
          sendCalls.push(method);
          return { data: "aGVsbG8=" };
        }),
      } as unknown as CDPClient;
    });
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(ExtractionFailedError);

    // No Escape was dispatched at all on the failure path, so the screenshot
    // and the modal-scoped probes describe the modal that actually failed.
    expect(sendCalls).not.toContain("Input.dispatchKeyEvent");
    expect(sendCalls).toContain("Page.captureScreenshot");
    warnSpy.mockRestore();
  });

  it("keeps propagating the caller's error when the capture itself fails", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupMocks(2);
    const { writeFile: wf } = await import("node:fs/promises");
    vi.mocked(wf).mockRejectedValueOnce(new Error("disk full"));

    // A capture-side failure must never replace the diagnosis it was written
    // to explain.
    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(ExtractionFailedError);
  });

  // -------------------------------------------------------------------------
  // Which TIER refused, asserted by CLASS (#840)
  // -------------------------------------------------------------------------
  //
  // The uneditable oracle's `scrapeSequence: [null]` fixture is titled
  // "totalReactions contradicts it" and asserts a bare `.rejects.toThrow()`.
  // Since #840 that fixture no longer reaches the cardinal it names: `null` is
  // refused one tier earlier, by the CONTAINER check, which returns before
  // `total` is consulted at all. It therefore passes identically with
  // `totalReactions: 0`, and it can no longer tell the two tiers apart. C1
  // forbids repairing it in place, so the discrimination it used to carry is
  // re-established here instead — by class, since the two tiers raise two
  // different classes and only the class says which one refused.
  //
  // Also pinned here: the ambiguity refusals the operation gained. Both
  // sibling surfaces cover this branch at the operation level
  // (`get-post-extraction-diagnostics.test.ts`, `search-posts.test.ts`), and
  // `isAmbiguous` is a hand-written shape check whose inversion would fail
  // silently — an ambiguous page would be scraped as if one dialect owned it.

  /**
   * Prime the mock positionally up to and including the scrape, then let the
   * caller decide what the scrape returns.  Diagnostics stay OFF, so no
   * capture probe is consumed and the sequence stays exactly this long.
   *
   * @param scrape - What the engager-scrape evaluate resolves to.
   * @param total - The cardinal the total call reports.
   * @param trigger - What the find call resolves to.
   * @returns The evaluate mock, for call-count assertions.
   */
  function primeUpToScrape(
    scrape: unknown,
    total = 2,
    trigger: unknown = true,
  ) {
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
    evaluateMock.mockResolvedValueOnce(trigger); // find the reactions trigger
    evaluateMock.mockResolvedValueOnce(true); // modal readiness
    evaluateMock.mockResolvedValueOnce(total);
    evaluateMock.mockResolvedValueOnce(scrape);

    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        navigate: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateMock,
        send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
      } as unknown as CDPClient;
    });

    return evaluateMock;
  }

  it("refuses at the CONTAINER tier with DOMVariantUnsupportedError when the scrape resolves no modal root", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    // `totalReactions: 0` deliberately: a cardinal that CORROBORATES an empty
    // list. If this still raises — and it must — the refusal cannot have come
    // from the cardinal tier, which is what the oracle's fixture can no longer
    // establish on its own.
    const evaluateMock = primeUpToScrape(null, 0);

    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toBeInstanceOf(DOMVariantUnsupportedError);

    // Refused before the scroll, before the detect probe, before the capture:
    // 1 readiness + 1 find + 1 modal ready + 1 total + 1 scrape.
    expect(evaluateMock).toHaveBeenCalledTimes(5);
  });

  it("refuses at the CARDINAL tier with ExtractionFailedError when the container resolved and held no rows", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    setupMocks(2);

    // Same emptiness, one tier down: the container DID resolve, so the empty
    // array is a reading rather than a failure to read, and only the cardinal
    // can contradict it.
    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toBeInstanceOf(ExtractionFailedError);
  });

  it("refuses with DOMVariantAmbiguousError when two adapters claim the trigger", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const evaluateMock = primeUpToScrape(null, 0, {
      ambiguousVariants: ["sdui", "legacy"],
    });

    // A hybrid page. Clicking one dialect's affordance on a page also speaking
    // the other opens a modal nothing downstream is bound to read, so this
    // refuses BEFORE the click rather than scraping whatever opened.
    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toBeInstanceOf(DOMVariantAmbiguousError);

    // 1 readiness + 1 find, and nothing after it.
    expect(evaluateMock).toHaveBeenCalledTimes(2);
  });

  it("refuses with DOMVariantAmbiguousError when two adapters claim the open modal", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const evaluateMock = primeUpToScrape({
      ambiguousVariants: ["sdui", "legacy"],
    });

    // Ambiguity can also appear only once the modal is open — the trigger was
    // unambiguous, the modal is not — which is why the check is repeated on
    // the scrape rather than trusted from the pre-click reading.
    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toBeInstanceOf(DOMVariantAmbiguousError);

    expect(evaluateMock).toHaveBeenCalledTimes(5);
  });

  // -------------------------------------------------------------------------
  // The same two tiers, refused by the SCROLL rather than by the scrape (#840)
  // -------------------------------------------------------------------------
  //
  // The scroll used to answer both of these with `false`, which the collect
  // loop reads as *reached the bottom* — so a modal that re-rendered into an
  // unresolvable state mid-collection broke the loop, and the cardinal tier
  // stayed quiet because the rows scraped BEFORE the re-render make
  // `extractedCount` positive. The call returned a truncated list against the
  // modal's own total, with no error, and the next scrape — the one that would
  // have raised — never ran.
  //
  // Both fixtures give the first scrape a row on purpose: the container
  // resolved and the scrape succeeded, so nothing before the scroll can
  // refuse, and the raise can only have come from the scroll itself. A cardinal
  // larger than that row is what sends the loop to the scroll at all, and it
  // must not raise on its own — a partial read against a larger cardinal is
  // legal on this surface (see the residual in ADR-008 § Residuals).

  /** One engager row, as a successful scrape returns it. */
  const ONE_ENGAGER = [
    {
      firstName: "Jane",
      lastName: "Doe",
      publicId: "janedoe",
      headline: "Software Engineer at ACME",
      engagementType: "LIKE",
    },
  ];

  it("refuses at the CONTAINER tier with DOMVariantUnsupportedError when a scroll resolves no modal root", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const evaluateMock = primeUpToScrape(ONE_ENGAGER, 5);
    evaluateMock.mockResolvedValueOnce(null); // the scroll resolves no modal

    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT, count: 5 }),
    ).rejects.toBeInstanceOf(DOMVariantUnsupportedError);

    // Refused on the scroll, before any further scrape:
    // 1 readiness + 1 find + 1 modal ready + 1 total + 1 scrape + 1 scroll.
    expect(evaluateMock).toHaveBeenCalledTimes(6);
  });

  it("refuses with DOMVariantAmbiguousError when two adapters claim the modal a scroll lands on", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const evaluateMock = primeUpToScrape(ONE_ENGAGER, 5);
    evaluateMock.mockResolvedValueOnce({
      ambiguousVariants: ["sdui", "legacy"],
    });

    // A hybrid page that only became one mid-collection: the modal the scrape
    // read was unambiguous, the one the scroll landed on is not.
    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT, count: 5 }),
    ).rejects.toBeInstanceOf(DOMVariantAmbiguousError);

    expect(evaluateMock).toHaveBeenCalledTimes(6);
  });
});
