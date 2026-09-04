// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPClient } from "../client.js";
import {
  CDPConnectionError,
  CDPEvaluationError,
  CDPTimeoutError,
} from "../errors.js";

// The mocked pause ADVANCES the fake clock rather than resolving into a real
// one, per ADR-004 § Decision 5 (polling and timeout unit tests drive time
// explicitly).  That is not a speed optimisation: the gate's deadline is read
// from `Date.now()`, so against a real clock the attempt COUNT depends on how
// the host schedules this process -- which would put a flake in the suite
// whose subject exists to remove one.  Driving the clock makes every count
// below exact.  The token's timestamp component is frozen by
// `vi.useFakeTimers()` rather than by this mock -- and stays frozen in the
// distinctness test only because that test's gate succeeds on its first poll,
// so this mock is never called there.  That is what lets it grade the install
// counter rather than the clock.
vi.mock("../../utils/delay.js", () => ({
  delay: vi.fn((ms: number) => {
    vi.advanceTimersByTime(ms);
    return Promise.resolve();
  }),
}));

const {
  DEFAULT_GATE_TIMEOUT_MS,
  DEFAULT_INSTALL_ATTEMPTS,
  DEFAULT_POLL_INTERVAL_MS,
  EMPTY_DOCUMENT_HTML,
  INSTALL_TEST_TIMEOUT_MS,
  installDocument,
} = await import("./install-document.js");
const { delay } = await import("../../utils/delay.js");

const FRAME_ID = "FRAME-1";

/** `url` handed to every `Page.navigate` the helper drove. */
function navigations(send: ReturnType<typeof vi.fn>): string[] {
  return send.mock.calls
    .filter(([method]) => method === "Page.navigate")
    .map(([, params]) => String((params as { url?: unknown }).url));
}

/** `content` of the marker installed by each attempt, in order. */
function installedTokens(send: ReturnType<typeof vi.fn>): string[] {
  return send.mock.calls
    .filter(([method]) => method === "Page.setDocumentContent")
    .map(
      ([, params]) =>
        /content="([^"]+)"/.exec(
          String((params as { html?: unknown }).html),
        )?.[1] ?? "",
    );
}

/**
 * A stand-in client whose `evaluate` answers from a scripted sequence.
 *
 * `send` answers `Page.getFrameTree` and records everything, so the assertions
 * below can read what was actually installed rather than assuming it.
 */
function stubClient(
  evaluate: ReturnType<typeof vi.fn>,
  overrides?: {
    send?: (method: string) => Promise<unknown>;
    waitForEvent?: ReturnType<typeof vi.fn>;
  },
): {
  client: CDPClient;
  send: ReturnType<typeof vi.fn>;
  waitForEvent: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn(async (method: string) => {
    if (overrides?.send) {
      return overrides.send(method);
    }
    if (method === "Page.getFrameTree") {
      return { frameTree: { frame: { id: FRAME_ID } } };
    }
    return undefined;
  });
  // A healthy page fires the load event; the tests that care drive it
  // otherwise.  Modelled rather than ignored because the reset's whole point is
  // that it does NOT return before this resolves.
  const waitForEvent = overrides?.waitForEvent ?? vi.fn().mockResolvedValue({});
  return {
    client: { evaluate, send, waitForEvent } as unknown as CDPClient,
    send,
    waitForEvent,
  };
}

/** The `html` handed to `Page.setDocumentContent` on the first call. */
function installedHtml(send: ReturnType<typeof vi.fn>): string {
  const call = send.mock.calls.find(
    ([method]) => method === "Page.setDocumentContent",
  );
  return String((call?.[1] as { html?: unknown } | undefined)?.html ?? "");
}

describe("installDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("installs the caller's markup, to the frame the frame tree names", async () => {
    const { client, send } = stubClient(vi.fn().mockResolvedValue(true));

    await installDocument(client, "<!doctype html><html><body><p>x</p></body></html>");

    const call = send.mock.calls.find(
      ([method]) => method === "Page.setDocumentContent",
    );
    expect((call?.[1] as { frameId?: unknown }).frameId).toBe(FRAME_ID);
    // Appended, never woven in: the caller's document is the prefix of what
    // ships, so nothing about how it parses on its own can change.
    expect(installedHtml(send)).toMatch(
      /^<!doctype html><html><body><p>x<\/p><\/body><\/html>/,
    );
  });

  it("gates on a marker carried by the markup it just installed", async () => {
    const evaluate = vi.fn().mockResolvedValue(true);
    const { client, send } = stubClient(evaluate);

    await installDocument(client, "<p>x</p>");

    // The token is read out of what was installed rather than restated here:
    // the point is that the gate and the installed document agree, which a
    // hard-coded expectation on both sides could not witness.
    const token = /content="([^"]+)"/.exec(installedHtml(send))?.[1];
    expect(token).toBeDefined();
    expect(String(evaluate.mock.calls[0]?.[0])).toContain(String(token));
  });

  it("emits one expression that both observes and removes, and nothing else", async () => {
    const evaluate = vi.fn().mockResolvedValue(true);
    const { client } = stubClient(evaluate);

    await installDocument(client, "<p>x</p>");

    // Observation and removal are one expression, so the document handed back
    // is the caller's markup and nothing else — and the LAST thing this helper
    // did through `evaluate` was a successful read of it.  Hence the call
    // count: two evaluations would mean a removal that could outlive its own
    // observation.
    //
    // The `querySelectorAll` exclusion is not redundant with the line above
    // it.  `querySelector` is a prefix of `querySelectorAll`, so a bare
    // substring check would accept either; the trailing paren narrows it, and
    // the negative assertion is what says out loud that the two are NOT
    // interchangeable here -- only `querySelector` returns the `null` the gate
    // branches on.
    expect(evaluate).toHaveBeenCalledTimes(1);
    const source = String(evaluate.mock.calls[0]?.[0]);
    expect(source).toMatch(/document\.querySelector\(/);
    expect(source).not.toMatch(/querySelectorAll/);
    expect(source).toMatch(/\.remove\(\)/);
  });

  it("gates through the plain no-contextId call the assertions themselves make", async () => {
    const evaluate = vi.fn().mockResolvedValue(true);
    const { client } = stubClient(evaluate);

    await installDocument(client, "<p>x</p>");

    // The whole design rests on the gate observing the document through the
    // SAME resolution the callers get.  `CDPClient.evaluate` takes
    // `(expression, awaitPromise?, contextId?)`, so a future change pinning a
    // context here -- and only here -- would have the gate watch a context the
    // assertions never see, reinstating #888 while every test stayed green.
    // One argument is what keeps the two on the same path.
    expect(evaluate.mock.calls[0]).toHaveLength(1);
  });

  it("waits the configured interval between polls, and its own default when given none", async () => {
    const scripted = () =>
      vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await installDocument(stubClient(scripted()).client, "<p>x</p>", {
      pollInterval: 250,
    });
    expect(delay).toHaveBeenLastCalledWith(250);

    await installDocument(stubClient(scripted()).client, "<p>x</p>");
    expect(delay).toHaveBeenLastCalledWith(DEFAULT_POLL_INTERVAL_MS);
  });

  it("budgets enough time to poll many times, not merely once", () => {
    // Bounded from BELOW as well as above: a gate collapsed to a single
    // immediate attempt still passes every behavioural test here, because on a
    // healthy runner the first attempt succeeds.  What it loses is the retry
    // window -- the entire point on the slow runner where #888 lives.
    expect(DEFAULT_GATE_TIMEOUT_MS).toBeGreaterThan(DEFAULT_POLL_INTERVAL_MS * 10);
  });

  it("polls on its own default budget, not on some smaller one", async () => {
    // The two constant-vs-constant assertions above grade the VALUE and not the
    // wiring, so a default quietly reduced to a handful of polls satisfies both
    // -- while collapsing the gate on exactly the slow runner the 5 000 ms was
    // measured against.  Every consuming call site passes no options at all, so
    // the default is the only budget that ever runs in practice.
    const evaluate = vi.fn().mockResolvedValue(false);
    evaluate.mockResolvedValueOnce(false);
    for (let i = 0; i < 49; i++) {
      evaluate.mockResolvedValueOnce(false);
    }
    evaluate.mockResolvedValueOnce(true);
    const { client } = stubClient(evaluate);

    await installDocument(client, "<p>x</p>");

    // 51 polls is 1 000 fake ms of budget at the default interval -- far more
    // than a token default would allow, and far less than the real one.
    expect(evaluate).toHaveBeenCalledTimes(51);
  });

  it("keeps polling on any answer that is not literally true", async () => {
    // `CDPClient.evaluate` casts its result with `as T` and validates nothing,
    // so an evaluation whose result carries no value arrives as `undefined`.
    // A gate written as `!== false` would read that as success and hand back a
    // document nobody confirmed -- #888's own shape, through the gate built to
    // close it.
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("true")
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(true);
    const { client } = stubClient(evaluate);

    await installDocument(client, "<p>x</p>");

    expect(evaluate).toHaveBeenCalledTimes(4);
  });

  it("does not return until an evaluation reports the marker present", async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { client } = stubClient(evaluate);

    await installDocument(client, "<p>x</p>");

    // Three polls, not one: returning after the first `false` is exactly
    // the early return #888 is about.
    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it("throws instead of returning when the marker never appears", async () => {
    const evaluate = vi.fn().mockResolvedValue(false);
    const { client } = stubClient(evaluate);

    // A gate that cannot be satisfied must fail loudly.  The behaviour it
    // replaces was an assertion reading 0 for every selector, over a document
    // nobody had confirmed was there.
    // Matched on the message as well as the class: `CDPClient.send` throws
    // `CDPTimeoutError` too, so a mutant that abandoned the loop and rethrew a
    // request timeout would satisfy a type-only assertion.
    await expect(
      installDocument(client, "<p>x</p>", { timeout: 0 }),
    ).rejects.toThrow(/sentinel .* never matched/);
    await expect(
      installDocument(client, "<p>x</p>", { timeout: 0 }),
    ).rejects.toBeInstanceOf(CDPTimeoutError);
  });

  it("makes at least one poll even with the deadline already spent", async () => {
    const evaluate = vi.fn().mockResolvedValue(true);
    const { client } = stubClient(evaluate);

    await installDocument(client, "<p>x</p>", { timeout: 0 });

    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("re-polls after an evaluation that throws, which is the window being waited out", async () => {
    const evaluate = vi
      .fn()
      .mockRejectedValueOnce(new CDPEvaluationError("Execution context was destroyed"))
      .mockRejectedValueOnce(new CDPEvaluationError("Cannot find context with specified id"))
      .mockResolvedValueOnce(true);
    const { client } = stubClient(evaluate);

    await installDocument(client, "<p>x</p>");

    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it("absorbs a dropped connection the same way, and names it rather than the sentinel alone", async () => {
    // `CDPClient.send` throws `CDPConnectionError` on a closed socket, and the
    // gate's catch swallows every class alike.  That disposition is deliberate
    // -- the window being waited out is exactly when evaluations misbehave --
    // but it means the timeout would otherwise report "sentinel never matched"
    // about a fault that has nothing to do with the sentinel.
    const evaluate = vi.fn().mockRejectedValue(new CDPConnectionError("Not connected"));
    const { client } = stubClient(evaluate);

    const failure = await installDocument(client, "<p>x</p>", {
      timeout: 0,
    }).catch((error: unknown) => error);

    expect((failure as Error).message).toMatch(/Not connected/);
    // ...and the report is still a report.  Matching the absorbed error's
    // message alone cannot distinguish this from a mutant that abandoned the
    // report and rethrew the raw error -- which is the failure mode this test
    // is named against, so the class and the report's own markers are pinned
    // alongside it.
    expect(failure).toBeInstanceOf(CDPTimeoutError);
    expect((failure as Error).message).toMatch(/sentinel .* never matched/);
    expect((failure as Error).message).toMatch(/page state at giving up:/);
  });

  it("quotes the last evaluation error in the timeout, so absorption is not silence", async () => {
    const evaluate = vi
      .fn()
      .mockRejectedValue(new CDPEvaluationError("Execution context was destroyed"));
    const { client } = stubClient(evaluate);

    const failure = await installDocument(client, "<p>x</p>", {
      timeout: 0,
    }).catch((error: unknown) => error);

    expect((failure as Error).message).toMatch(/Execution context was destroyed/);
    expect(failure).toBeInstanceOf(CDPTimeoutError);
    expect((failure as Error).message).toMatch(/sentinel .* never matched/);
  });

  it("keeps that error even when later attempts merely report the marker absent", async () => {
    // The interesting shape, and the one a naive `lastError` reset loses: the
    // context erred once and then answered cleanly about a document that is
    // still the wrong one.  Reporting "sentinel never matched" with no cause
    // would describe the least informative half of what happened.
    const evaluate = vi
      .fn()
      .mockRejectedValueOnce(new CDPEvaluationError("Execution context was destroyed"))
      .mockResolvedValue(false);
    const { client } = stubClient(evaluate);

    const failure = await installDocument(client, "<p>x</p>", {
      timeout: 30,
    }).catch((error: unknown) => error);

    expect((failure as Error).message).toMatch(/Execution context was destroyed/);
    expect(failure).toBeInstanceOf(CDPTimeoutError);
    expect((failure as Error).message).toMatch(/sentinel .* never matched/);
    expect(evaluate.mock.calls.length).toBeGreaterThan(1);
  });

  it("reports how long it actually waited, not just the budget it was given", async () => {
    // The budget bounds the gate's retries; it cannot interrupt a single
    // in-flight request, which the client's own timeout bounds.  A message
    // quoting only the budget would therefore be false about elapsed time on
    // exactly the runs worth diagnosing.
    //
    // The two numbers are driven APART on purpose: a zero budget makes elapsed
    // zero as well, and against that the message could quote the budget twice
    // and still read correctly.  Here the single attempt itself consumes 250
    // fake milliseconds against a budget of 0.  `attempts` is pinned so the
    // number stays the one attempt's own cost, and so the diagnostic probe --
    // which runs after the clock is read -- cannot be what makes it differ.
    const evaluate = vi.fn(() => {
      vi.advanceTimersByTime(250);
      return Promise.resolve(false);
    });
    const { client } = stubClient(evaluate);

    let message = "";
    try {
      await installDocument(client, "<p>x</p>", { timeout: 0, attempts: 1 });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/of 0ms each/);
    expect(
      /(\d+)ms elapsed since the first install began/.exec(message)?.[1],
    ).toBe("250");
  });

  it("makes exactly one poll when the budget is already spent", async () => {
    const evaluate = vi.fn().mockResolvedValue(false);
    const { client } = stubClient(evaluate);

    await expect(
      installDocument(client, "<p>x</p>", { timeout: 0, attempts: 1 }),
    ).rejects.toBeInstanceOf(CDPTimeoutError);
    // One poll, plus the diagnostic probe on the way out.  `attempts` is
    // pinned so this counts the poll LOOP rather than the retry loop.
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("issues a distinct marker per install, so a stale document cannot satisfy a later gate", async () => {
    const first = stubClient(vi.fn().mockResolvedValue(true));
    await installDocument(first.client, "<p>x</p>");
    const second = stubClient(vi.fn().mockResolvedValue(true));
    await installDocument(second.client, "<p>x</p>");

    const tokenOf = (send: ReturnType<typeof vi.fn>): string =>
      String(/content="([^"]+)"/.exec(installedHtml(send))?.[1]);

    expect(tokenOf(first.send)).not.toBe(tokenOf(second.send));

    // ...and the discriminator is the install counter, not the clock.  Under
    // the frozen clock these tokens share a timestamp component, so dropping
    // the counter collapses them -- which against a real clock would only show
    // up when two installs happened to land in the same millisecond, i.e.
    // least often on exactly the slow runners this exists for.
    const [firstSeq, firstStamp] = tokenOf(first.send).split("-");
    const [secondSeq, secondStamp] = tokenOf(second.send).split("-");
    expect(firstStamp).toBe(secondStamp);
    expect(firstSeq).not.toBe(secondSeq);
  });

  it("keeps its whole worst case inside the budget it asks consumers to declare", () => {
    // Every attempt can burn a full gate budget AND every retry a full reset
    // wait -- the reset is handed the same budget -- so the worst case this file
    // sets is gates plus one-fewer resets, not one budget and not the gates
    // alone.  A consumer aborted by its own runner never prints the helper's
    // diagnostic at all, which is the failure this file exists to replace, one
    // level up.  The remaining slack is an allowance for the round trips
    // between them, which are bounded by the client's own timeout instead.
    const worstCase =
      DEFAULT_GATE_TIMEOUT_MS * DEFAULT_INSTALL_ATTEMPTS +
      DEFAULT_GATE_TIMEOUT_MS * (DEFAULT_INSTALL_ATTEMPTS - 1);
    expect(worstCase).toBeLessThan(INSTALL_TEST_TIMEOUT_MS / 2);
  });

  it("retries the whole install, with a marker no earlier attempt used", async () => {
    // The gate as first shipped only DETECTED the fault: the first windows run
    // polled cleanly for 3 106 ms and never saw the marker, which turns a
    // silent wrong answer into a red suite.  Better, and still not the bar --
    // #888 asks for windows CI to pass repeatedly.  So a failed gate re-drives
    // the install instead of ending the run.
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { client, send } = stubClient(evaluate);

    await installDocument(client, "<p>x</p>", { timeout: 0 });

    const tokens = installedTokens(send);
    expect(tokens).toHaveLength(2);
    // Distinct by construction: a retry satisfied by the document the previous
    // attempt installed would re-open #888 through the recovery path.
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it("replaces the frame's document between attempts, and not before the first", async () => {
    // The navigation is the only thing separating a retry from more polling.
    // `Page.setDocumentContent` was never observed to emit
    // `Runtime.executionContextCreated` -- measured, see the helper, which is
    // careful to hold the mechanism open rather than conclude from that -- so
    // re-sending it alone is not expected to be a second chance.  Whether
    // navigating is what actually recovers is the same open hypothesis.
    const { client, send } = stubClient(
      vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
    );

    await installDocument(client, "<p>x</p>", { timeout: 0 });

    expect(navigations(send)).toEqual(["about:blank"]);
    // ...and it is a RESET, so it precedes the attempt it serves rather than
    // trailing the one that failed -- otherwise a run that succeeds on the
    // first attempt would still leave the page navigated away.
    const methods = send.mock.calls.map(([method]) => String(method));
    expect(methods.indexOf("Page.navigate")).toBeGreaterThan(
      methods.indexOf("Page.setDocumentContent"),
    );
  });

  it("never navigates when the first attempt succeeds", async () => {
    const { client, send } = stubClient(vi.fn().mockResolvedValue(true));

    await installDocument(client, "<p>x</p>");

    // The happy path is every run on every healthy runner.  Recovery that
    // taxes it would be paid on every install of every Tier-2 suite.
    expect(navigations(send)).toEqual([]);
  });

  it("waits for the reset to commit before installing over it", async () => {
    // `Page.navigate` returns when the navigation is INITIATED, not when it has
    // landed -- which every production navigate site that depends on the new
    // document says out loud by pairing the call with a readiness wait.
    // Returning on initiation lets
    // the pending `about:blank` commit AFTER the retry has installed its markup
    // and after the gate has observed it, so the caller would then count 0 for
    // every selector: #888's own signature, re-entering through the recovery
    // meant to close it.
    const order: string[] = [];
    const waitForEvent = vi.fn(async () => {
      order.push("subscribe");
      await Promise.resolve();
      order.push("load");
      return {};
    });
    const { client } = stubClient(
      vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      {
        send: async (method: string) => {
          order.push(method);
          if (method === "Page.getFrameTree") {
            return { frameTree: { frame: { id: FRAME_ID } } };
          }
          return undefined;
        },
        waitForEvent,
      },
    );

    await installDocument(client, "<p>x</p>", { timeout: 0 });

    // Subscribed before the navigation is issued -- otherwise the wait races
    // the event on a document as cheap to load as `about:blank` -- awaited
    // after it, and both strictly before the reinstall.
    const at = (step: string): number => order.indexOf(step);
    const reinstall = order.lastIndexOf("Page.setDocumentContent");

    // Stated as orderings rather than as equality over the whole sequence:
    // exact equality would also assert that the frame tree is re-read every
    // attempt and that no other CDP method is ever sent, neither of which is a
    // claim this test is making.
    expect(at("Page.enable")).toBeLessThan(at("subscribe"));
    expect(at("subscribe")).toBeLessThan(at("Page.navigate"));
    expect(at("Page.navigate")).toBeLessThan(at("load"));
    expect(at("load")).toBeLessThan(reinstall);
    expect(reinstall).toBeGreaterThan(at("Page.setDocumentContent"));

    // The event NAME is the confirmation.  `Page.frameStartedLoading` fires
    // before the document commits, so waiting on it would return while the
    // navigation is still in flight -- the pre-#888 race, restored, and
    // invisible to any assertion that only watches the mock being called.
    // The budget is pinned too: omitting it silently falls back to the
    // client's own 15 s request timeout, which is three times the gate budget
    // and breaks the worst case this file exports a constant to bound.
    expect(waitForEvent).toHaveBeenCalledWith("Page.loadEventFired", 0);
  });

  it("does not install over a reset it could not confirm", async () => {
    // The one move this helper must never make.  A reset whose load event never
    // arrives leaves a navigation that may still commit, and installing into
    // that frame is how a confirmed-looking install ends up on a blank page.
    // Failing the attempt is the conservative direction: the run is red and
    // says why, rather than green and wrong.
    const evaluate = vi.fn().mockResolvedValue(false);
    const { client, send } = stubClient(evaluate, {
      waitForEvent: vi
        .fn()
        .mockRejectedValue(new CDPTimeoutError("Timed out waiting for event")),
    });

    await expect(
      installDocument(client, "<p>x</p>", { timeout: 0, attempts: 2 }),
    ).rejects.toThrow(/did not commit/);

    // Exactly one install: the first attempt's.  A second would be the defect.
    expect(installedTokens(send)).toHaveLength(1);
  });

  it("disables the Page domain again even when the reset fails", async () => {
    // Enabled only for the wait, per the idiom the production navigate sites
    // use.  Leaving it enabled would have this helper mutate the domain state
    // of a client shared with every test that follows in the suite.
    const { client, send } = stubClient(vi.fn().mockResolvedValue(false), {
      waitForEvent: vi
        .fn()
        .mockRejectedValue(new CDPTimeoutError("Timed out waiting for event")),
    });

    await installDocument(client, "<p>x</p>", {
      timeout: 0,
      attempts: 2,
    }).catch(() => undefined);

    const methods = send.mock.calls.map(([method]) => String(method));
    expect(methods).toContain("Page.disable");
  });

  it("attaches what the page looked like at the moment it gave up", async () => {
    // "sentinel never matched" cannot separate the two readings that matter:
    // the markup arrived and the marker was lost, versus the evaluation is
    // answering from a document the install never reached.  The windows run
    // that motivated the retry was undiagnosable for exactly this reason, and
    // the retry above is a PREDICTION about the mechanism -- so the next
    // occurrence has to be decidable from its log rather than from another
    // round of guessing.
    const evaluate = vi
      .fn()
      .mockResolvedValue(false)
      .mockResolvedValue(false);
    const { client } = stubClient(evaluate);
    evaluate.mockImplementation((expression: string) =>
      Promise.resolve(
        expression.includes("readyState")
          ? '{"url":"about:blank","documentLength":42,"sentinels":0}'
          : false,
      ),
    );

    await expect(
      installDocument(client, "<p>x</p>", { timeout: 0 }),
    ).rejects.toThrow(/page state at giving up: .*documentLength.*42/);
  });

  it("reports every attempt, not only the last one", async () => {
    const evaluate = vi.fn().mockResolvedValue(false);
    const { client } = stubClient(evaluate);

    let message = "";
    try {
      await installDocument(client, "<p>x</p>", { timeout: 0, attempts: 3 });
    } catch (error) {
      message = (error as Error).message;
    }

    // Each attempt names its own sentinel, so the log shows whether the retries
    // really were separate installs.  A count alone could not say that.
    expect(message).toMatch(/attempt 1: sentinel/);
    expect(message).toMatch(/attempt 3: sentinel/);
    expect(message).toMatch(/in 3 attempt\(s\)/);
  });

  it("lets a failed install request through as itself", async () => {
    // Absorption is scoped to the GATE, where an error is the very window being
    // waited out.  A dead connection is not that, and relabelling it as a gate
    // timeout would bury the actual fault -- so it is not folded into the
    // report, it is thrown.
    const { client } = stubClient(vi.fn().mockResolvedValue(true), {
      send: async (method: string) => {
        if (method === "Page.getFrameTree") {
          return { frameTree: { frame: { id: FRAME_ID } } };
        }
        throw new CDPConnectionError("Not connected");
      },
    });

    await expect(
      installDocument(client, "<p>x</p>", { attempts: 1 }),
    ).rejects.toBeInstanceOf(CDPConnectionError);
  });

  it("retries an install request that fails before the last attempt", async () => {
    // A socket blip on the install itself is as retryable as a gate that will
    // not settle, and the whole point of the loop is that one bad attempt is
    // not the run.  Only the LAST one propagates, which is what keeps the
    // disposition above from becoming "swallow it three times".
    let installs = 0;
    const { client } = stubClient(vi.fn().mockResolvedValue(true), {
      send: async (method: string) => {
        if (method === "Page.getFrameTree") {
          return { frameTree: { frame: { id: FRAME_ID } } };
        }
        if (method === "Page.setDocumentContent") {
          installs += 1;
          if (installs === 1) {
            throw new CDPConnectionError("Not connected");
          }
        }
        return undefined;
      },
    });

    await expect(
      installDocument(client, "<p>x</p>", { timeout: 0 }),
    ).resolves.toBeUndefined();
    expect(installs).toBe(2);
  });

  it("keeps earlier attempts in the report rather than only the last", async () => {
    // The accumulated context is the diagnostic.  An install request that fails
    // on attempt 2 must not erase the fact that attempt 1's gate had already
    // failed -- the single most informative line in such a run.
    let installs = 0;
    const { client } = stubClient(vi.fn().mockResolvedValue(false), {
      send: async (method: string) => {
        if (method === "Page.getFrameTree") {
          return { frameTree: { frame: { id: FRAME_ID } } };
        }
        if (method === "Page.setDocumentContent") {
          installs += 1;
          if (installs === 2) {
            throw new CDPConnectionError("Not connected");
          }
        }
        return undefined;
      },
    });

    let message = "";
    try {
      await installDocument(client, "<p>x</p>", { timeout: 0, attempts: 3 });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/attempt 1: sentinel/);
    expect(message).toMatch(/attempt 2: install request failed: Not connected/);
  });

  it("drives one install even when asked for none", async () => {
    // `attempts <= 0` -- or `NaN`, where every comparison is false -- must not
    // mean "return success having installed nothing".  That is the silent
    // wrong answer this file exists to remove, re-entering through the front
    // door of its own recovery option.
    const evaluate = vi.fn().mockResolvedValue(true);
    const { client, send } = stubClient(evaluate);

    await installDocument(client, "<p>x</p>", { attempts: 0 });
    expect(installedTokens(send)).toHaveLength(1);

    for (const attempts of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      // `Infinity` is the one that does not merely misbehave: an unbounded
      // retry loop is a test that never finishes, which is a worse failure than
      // any this helper guards against.
      const odd = stubClient(vi.fn().mockResolvedValue(true));
      await installDocument(odd.client, "<p>x</p>", { attempts });
      expect(installedTokens(odd.send)).toHaveLength(1);
    }
  });

  it("treats a non-finite budget as no budget rather than an endless one", async () => {
    // Paired with a gate that never succeeds, deliberately: a passing gate
    // returns before the deadline is ever consulted, so the same case with
    // `mockResolvedValue(true)` would go green against a loop that hangs.
    for (const timeout of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const { client } = stubClient(vi.fn().mockResolvedValue(false));
      await expect(
        installDocument(client, "<p>x</p>", { timeout, attempts: 1 }),
      ).rejects.toBeInstanceOf(CDPTimeoutError);
    }
  });

  it("exports an empty document that installs in standards mode", () => {
    // Quirks mode answers layout under different rules, and the suite that
    // installs this constant reads layout: `dom-automation`'s `scrollTo` test
    // builds a 3 000 px page and asserts the scrolled element's
    // `getBoundingClientRect().top` against `window.innerHeight`.
    expect(EMPTY_DOCUMENT_HTML).toMatch(/^<!doctype html>/i);
    expect(EMPTY_DOCUMENT_HTML).toContain("<body></body>");
  });
});
