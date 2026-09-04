// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPClient } from "../client.js";
import { CDPEvaluationError, CDPTimeoutError } from "../errors.js";

// The gate's pauses are not what is under test here — the ORDER of its
// attempts is.  Mocking the primitive keeps a deliberately slow poll from
// buying wall-clock time in the unit tier.
vi.mock("../../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

const { DEFAULT_GATE_TIMEOUT_MS, EMPTY_DOCUMENT_HTML, installDocument } =
  await import("./install-document.js");

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

  it("removes the marker in the same evaluation that observes it", async () => {
    const evaluate = vi.fn().mockResolvedValue(true);
    const { client } = stubClient(evaluate);

    await installDocument(client, "<p>x</p>");

    // Observation and removal are one expression, so the document handed back
    // is the caller's markup and nothing else — and the LAST thing this helper
    // did through `evaluate` was a successful read of it.
    const source = String(evaluate.mock.calls[0]?.[0]);
    expect(source).toContain("querySelector");
    expect(source).toContain(".remove()");
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
    const evaluate = vi.fn().mockResolvedValue(false);
    const { client } = stubClient(evaluate);

    await expect(
      installDocument(client, "<p>x</p>", { timeout: 0 }),
    ).rejects.toThrow(/elapsed since install began/);
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
