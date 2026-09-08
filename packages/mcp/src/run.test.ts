// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runStdioBin } from "./run.js";

const { runStdioServer } = vi.hoisted(() => ({ runStdioServer: vi.fn() }));
vi.mock("./stdio.js", () => ({ runStdioServer }));

/**
 * The coverage the bin entrypoint itself cannot carry.
 * `packages/mcp/src/index.ts` is excluded from the coverage gate as a bin
 * entrypoint — it starts a server at module scope, so importing it runs the
 * program instead of testing it — which is why the rejection path lives in
 * `run.ts` and not there (#945).  This measures it.
 *
 * `runStdioServer` is mocked rather than driven for real: the genuine one
 * attaches a `data` listener to `process.stdin` and never returns under normal
 * operation, so a real call would hang the worker.  What is under test is not
 * that function — it has its own suite — but what this module does with the
 * three failures that can escape it.
 */
describe("runStdioBin", () => {
  const originalExitCode = process.exitCode;
  let exit: ReturnType<typeof vi.spyOn>;
  let write: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    runStdioServer.mockReset();
    exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("awaits startup to completion before resolving", async () => {
    let finished = false;

    // The `await` on a timer is the falsifier: a body that called
    // `runStdioServer()` without awaiting it would return before this line
    // ran, leaving `finished` false — and would put the rejection back outside
    // the catch, which is the bug.
    runStdioServer.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      finished = true;
    });

    await runStdioBin();

    expect(finished).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("reports a rejecting startup on stderr and exits non-zero", async () => {
    runStdioServer.mockRejectedValue(new Error("EPIPE"));

    await runStdioBin();

    expect(write).toHaveBeenCalledWith("EPIPE\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("reports a synchronous throw from inside startup", async () => {
    // The two shapes the issue names as reachable before anything is awaited:
    // `createServer()` or `new StdioServerTransport()` throwing.
    runStdioServer.mockImplementation(() => {
      throw new Error("createServer failed");
    });

    await runStdioBin();

    expect(write).toHaveBeenCalledWith("createServer failed\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("reports a rejection that lands across a macrotask tick", async () => {
    // The post-`connect()` EPIPE shape: startup has already gone async by the
    // time it fails, so nothing synchronous is left on the stack to catch it.
    runStdioServer.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      throw new Error("write EPIPE");
    });

    await runStdioBin();

    expect(write).toHaveBeenCalledWith("write EPIPE\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("renders a non-Error rejection through errorMessage", async () => {
    runStdioServer.mockRejectedValue("bare string rejection");

    await runStdioBin();

    expect(write).toHaveBeenCalledWith("bare string rejection\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("renders a cause chain, so a wrapped failure keeps its origin", async () => {
    runStdioServer.mockRejectedValue(
      new Error("could not start", { cause: new Error("EADDRINUSE") }),
    );

    await runStdioBin();

    const reported = write.mock.calls[0]?.[0];
    expect(reported).toContain("could not start");
    expect(reported).toContain("EADDRINUSE");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("still says something when the error renders no message", async () => {
    // Without a stand-in each of these would print a blank line and exit 1 —
    // a server that failed to start, with no diagnosis, at the one boundary
    // that has no prefix of its own.  The first two render "" outright.  The
    // whitespace cases are the ones a bare `length > 0` test lets through:
    // `errorMessage` does not trim a non-`Error` value, so a rejected "   "
    // comes back as three spaces — blank to a reader, non-empty to `length`.
    const silent: unknown[] = [
      new Error(""),
      Object.create(null) as unknown,
      "   ",
      "\n\t",
      { toString: () => "  " },
    ];

    // Every value must produce the SAME line, so a stand-in that has gone
    // missing is distinguishable from one that merely rendered something.
    const lines = new Set<string>();

    for (const empty of silent) {
      write.mockClear();
      runStdioServer.mockRejectedValue(empty);

      await runStdioBin();

      // Asserted BEFORE the argument is read, and the argument is read with no
      // `String()` around it.  Both halves matter, and the reason is the same
      // one the loop is about: dropping the stand-in in the write-NOTHING
      // direction — keeping the `process.exit(1)` but skipping the write when
      // the message is empty — leaves `mock.calls` empty, and
      // `String(undefined)` is the nine-character "undefined", which is
      // non-blank to `.trim().length`.  The coercion would pass the test that
      // exists to fail.  Without it the matcher rejects a non-string outright,
      // and the call-count assertion catches it before that.
      expect(write).toHaveBeenCalledTimes(1);
      const reported = write.mock.calls[0]?.[0] as string;

      expect(reported.trim().length).toBeGreaterThan(0);
      // Held here and nowhere else: every exact-value assertion in this file
      // is on the non-empty path, so a refactor moving the newline inside the
      // ternary would drop it on this branch alone.
      expect(reported.endsWith("\n")).toBe(true);
      lines.add(reported);
    }

    // One stand-in, not five values that each happened to render non-blank,
    // and it names this program: the sibling contract in
    // `packages/cli/src/run.ts` has a stand-in of the same shape, so a
    // copy-across would otherwise report a failed CLI command here.
    expect(lines.size).toBe(1);
    expect([...lines][0]).toContain("MCP server");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits non-zero even when reporting to stderr itself fails", async () => {
    // A failing `process.stderr.write` is one of the three paths #945 names.
    // It must not reject out of the function whose whole job is to report.
    runStdioServer.mockRejectedValue(new Error("boom"));
    write.mockImplementation(() => {
      throw new Error("EPIPE");
    });

    await expect(runStdioBin()).resolves.toBeUndefined();

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits rather than only setting an exit code", async () => {
    // `process.exitCode` alone would leave the bin hanging on the ref'd stdin
    // handle `StdioServerTransport.start()` attaches — see the module comment.
    // The observable here is that `process.exit` is the mechanism used.
    runStdioServer.mockRejectedValue(new Error("boom"));

    await runStdioBin();

    expect(exit).toHaveBeenCalledWith(1);
    expect(process.exitCode).toBeUndefined();
  });

  it("leaves a normally-returning startup alone", async () => {
    // The success path: `runStdioServer` resolves once the server is serving
    // and the signal handlers are registered.  Nothing is reported, and no
    // exit is forced — the process stays alive on its stdin handle.
    runStdioServer.mockResolvedValue(undefined);

    await runStdioBin();

    expect(write).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});
