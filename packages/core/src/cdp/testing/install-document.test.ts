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
// below exact.  It also freezes the token's timestamp component, which is what
// lets the distinctness test grade the install counter rather than the clock.
vi.mock("../../utils/delay.js", () => ({
  delay: vi.fn((ms: number) => {
    vi.advanceTimersByTime(ms);
    return Promise.resolve();
  }),
}));

const {
  DEFAULT_GATE_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  EMPTY_DOCUMENT_HTML,
  installDocument,
} = await import("./install-document.js");
const { delay } = await import("../../utils/delay.js");

/**
 * Vitest's own default per-test timeout, as of vitest 4.1.5.
 *
 * Transcribed rather than imported, and the assertion built on it is therefore
 * constant-against-constant.  Scoped honestly: it catches the gate default
 * being raised back above the runner's budget, which is the regression that
 * actually happened.  It does NOT catch the budget moving the other way — a
 * `testTimeout` added to `vitest.config.ts` below this number leaves the test
 * green while the premise it encodes stops holding.  Closing that would mean
 * reading the value the runner reads, which makes the assertion follow the
 * config rather than grade it.
 */
const VITEST_DEFAULT_TEST_TIMEOUT_MS = 5_000;

const FRAME_ID = "FRAME-1";

/**
 * A stand-in client whose `evaluate` answers from a scripted sequence.
 *
 * `send` answers `Page.getFrameTree` and records everything, so the assertions
 * below can read what was actually installed rather than assuming it.
 */
function stubClient(evaluate: ReturnType<typeof vi.fn>): {
  client: CDPClient;
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn(async (method: string) => {
    if (method === "Page.getFrameTree") {
      return { frameTree: { frame: { id: FRAME_ID } } };
    }
    return undefined;
  });
  return { client: { evaluate, send } as unknown as CDPClient, send };
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
    // did through `evaluate` was a successful read of it.  Asserted as a
    // single evaluation rather than by naming the DOM calls, because
    // `querySelector` is a prefix of `querySelectorAll`: a substring check
    // cannot tell the two apart, and only one of them has the `=== null`
    // semantics the gate depends on.
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

  it("waits the configured interval between attempts, and its own default when given none", async () => {
    const scripted = () =>
      vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await installDocument(stubClient(scripted()).client, "<p>x</p>", {
      pollInterval: 250,
    });
    expect(delay).toHaveBeenLastCalledWith(250);

    await installDocument(stubClient(scripted()).client, "<p>x</p>");
    expect(delay).toHaveBeenLastCalledWith(DEFAULT_POLL_INTERVAL_MS);
  });

  it("budgets enough time to retry many times, not merely once", () => {
    // Bounded from BELOW as well as above: a gate collapsed to a single
    // immediate attempt still passes every behavioural test here, because on a
    // healthy runner the first attempt succeeds.  What it loses is the retry
    // window -- the entire point on the slow runner where #888 lives.
    expect(DEFAULT_GATE_TIMEOUT_MS).toBeGreaterThan(DEFAULT_POLL_INTERVAL_MS * 10);
  });

  it("does not return until an evaluation reports the marker present", async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { client } = stubClient(evaluate);

    await installDocument(client, "<p>x</p>");

    // Three attempts, not one: returning after the first `false` is exactly
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

  it("makes at least one attempt even with the deadline already spent", async () => {
    const evaluate = vi.fn().mockResolvedValue(true);
    const { client } = stubClient(evaluate);

    await installDocument(client, "<p>x</p>", { timeout: 0 });

    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("retries an evaluation that throws, which is the window being waited out", async () => {
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

    await expect(
      installDocument(client, "<p>x</p>", { timeout: 0 }),
    ).rejects.toThrow(/Not connected/);
  });

  it("quotes the last evaluation error in the timeout, so absorption is not silence", async () => {
    const evaluate = vi
      .fn()
      .mockRejectedValue(new CDPEvaluationError("Execution context was destroyed"));
    const { client } = stubClient(evaluate);

    await expect(
      installDocument(client, "<p>x</p>", { timeout: 0 }),
    ).rejects.toThrow(/Execution context was destroyed/);
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

    await expect(
      installDocument(client, "<p>x</p>", { timeout: 30 }),
    ).rejects.toThrow(/Execution context was destroyed/);
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
    // fake milliseconds against a budget of 0.
    const evaluate = vi.fn(() => {
      vi.advanceTimersByTime(250);
      return Promise.resolve(false);
    });
    const { client } = stubClient(evaluate);

    let message = "";
    try {
      await installDocument(client, "<p>x</p>", { timeout: 0 });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/0ms gate budget/);
    expect(/(\d+)ms elapsed since install began/.exec(message)?.[1]).toBe("250");
  });

  it("terminates rather than spinning forever on a non-finite budget", async () => {
    // Deliberately paired with a gate that never succeeds: a passing gate
    // returns before the deadline is ever consulted, so the same case with
    // `mockResolvedValue(true)` would go green against a loop that hangs.
    // `Date.now() >= NaN` is false forever; a bad argument must not become a
    // hung helper, which is a worse failure than any this guards against.
    const evaluate = vi.fn().mockResolvedValue(false);
    const { client } = stubClient(evaluate);

    await expect(
      installDocument(client, "<p>x</p>", { timeout: Number.NaN }),
    ).rejects.toBeInstanceOf(CDPTimeoutError);
    expect(evaluate).toHaveBeenCalledTimes(1);
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

  it("keeps its deadline inside the budget of the tests that call it", () => {
    // Two of the four consumers install from `it` blocks that never override
    // vitest's default timeout, so a deadline above that is not a longer wait
    // -- it is an unreachable one.  The runner aborts first and prints
    // `Test timed out in 5000ms`, and the helper's own message, naming the
    // sentinel that never matched, is never emitted.  Failing loudly *with a
    // diagnostic* is the whole point; this pins the one direction of that
    // relationship a constant can pin, per the note on the constant above.
    expect(DEFAULT_GATE_TIMEOUT_MS).toBeLessThan(VITEST_DEFAULT_TEST_TIMEOUT_MS);
  });

  it("exports an empty document that installs in standards mode", () => {
    // Quirks mode answers layout under different rules, and the shared
    // search-results card loop applies an `offsetHeight` floor.
    expect(EMPTY_DOCUMENT_HTML).toMatch(/^<!doctype html>/i);
    expect(EMPTY_DOCUMENT_HTML).toContain("<body></body>");
  });
});
