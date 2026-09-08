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

/**
 * The half of the contract the suite above cannot reach.
 *
 * Every test above drives `runStdioBin` through the module instance this file
 * imported statically, so all of them are about what happens *after* the graph
 * has already evaluated.  #959 is about what happens *during* it: a throw at
 * module scope anywhere under `./stdio.js` used to run to completion before the
 * catch existed and escaped into the ESM loader as a crash dump.  That is why
 * these re-import `./run.js` per case with the graph broken deliberately, and
 * why they use `vi.doMock` with `vi.resetModules` rather than the file-level
 * `vi.mock` above: the mock has to differ per test, and the module under test
 * has to be evaluated fresh under each one.
 *
 * One vitest property shapes what may be asserted here.  A `vi.doMock` factory
 * that throws does NOT reject with the thrown value — vitest catches it and
 * substitutes an error of its own, whose text is about mocking and not about
 * the failure being simulated.  So a broken graph is used only where its
 * *shape* is what matters, and every case that asserts on rendered TEXT drives
 * the value through `runStdioServer` instead, which delivers it verbatim.  The
 * real loader's rendering is demonstrated against the built bin, which is the
 * only place it can be: no in-process mock reproduces an ESM instantiation
 * failure.
 */
describe("runStdioBin — import-graph coverage", () => {
  const originalExitCode = process.exitCode;
  let exit: ReturnType<typeof vi.spyOn>;
  let write: ReturnType<typeof vi.spyOn>;

  /** Stands in for `@lhremote/core` being the module that failed to evaluate. */
  const breakFormatter = () => {
    vi.doMock("@lhremote/core", () => {
      throw new Error("core graph failed");
    });
  };

  /** Stands in for a startup that rejects with `value` once the graph is up. */
  const rejectWith = (value: unknown) => {
    vi.doMock("./stdio.js", () => ({
      runStdioServer: vi.fn().mockRejectedValue(value),
    }));
  };

  const load = async () => (await import("./run.js")).runStdioBin;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.resetModules();
    exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.doUnmock("./stdio.js");
    vi.doUnmock("@lhremote/core");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("evaluates with its whole graph broken, so a throw cannot outrun the catch", async () => {
    // The structural falsifier for the entire fix, and the only test here that
    // asserts on the *import* rather than on a call.  Restore either specifier
    // to a static `import` at the top of `run.ts` and THIS line rejects: the
    // module never finishes evaluating, `runStdioBin` never exists to be
    // called, and the throw is back in the loader's hands.  Deliberately not
    // written as "the source has no static imports" — that is a fact about
    // text, and what has to hold is a fact about loading it.
    vi.doMock("./stdio.js", () => {
      throw new Error("server graph failed");
    });
    breakFormatter();

    const module = await import("./run.js");

    expect(typeof module.runStdioBin).toBe("function");
  });

  it("reports a rejecting server import rather than letting it escape", async () => {
    // #959's own case, in the only shape a mock can produce it.  The text is
    // vitest's, so only the report's shape is asserted; what makes this a real
    // falsifier is the `await` above — with a static import the module load
    // rejects and no report happens at all.
    vi.doMock("./stdio.js", () => {
      throw new Error("server graph failed");
    });

    await (await load())();

    expect(write).toHaveBeenCalledTimes(1);
    const reported = write.mock.calls[0]?.[0] as string;
    expect(reported.trim().length).toBeGreaterThan(0);
    expect(reported.endsWith("\n")).toBe(true);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("keeps the error's own text when the formatter is what failed", async () => {
    // The path `lastResortMessage` exists for, and the reason it is reachable
    // rather than defensive padding: `@lhremote/core` is inside the graph the
    // catch now covers, so its own failure arrives with the formatter
    // unloadable.  Printing the no-message stand-in here would be a false
    // statement about an error that plainly carried one.
    breakFormatter();
    rejectWith(new Error("EPIPE"));

    await (await load())();

    expect(write).toHaveBeenCalledWith("EPIPE\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("renders a non-Error value when the formatter is unavailable", async () => {
    breakFormatter();
    rejectWith("bare string rejection");

    await (await load())();

    expect(write).toHaveBeenCalledWith("bare string rejection\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("drops the cause chain when the formatter is unavailable, and says the head", async () => {
    // The documented cost of the degraded path, pinned so it is a decision and
    // not a surprise: `errorMessage` renders `Caused by:` lines and
    // `lastResortMessage` cannot, because recovering them would mean a second
    // formatter in a tree that refuses one.  The sibling test above holds the
    // undegraded behaviour, so the two together say which half is lost.
    breakFormatter();
    rejectWith(new Error("could not start", { cause: new Error("EADDRINUSE") }));

    await (await load())();

    expect(write).toHaveBeenCalledWith("could not start\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("still says something when the formatter is gone and the value renders nothing", async () => {
    // The degraded twin of the `errorMessage` loop above.  The last two are
    // reachable only here: `String()` is a call, not a coercion that always
    // succeeds, so a prototype-less value and a throwing `toString` take
    // `lastResortMessage`'s own catch — which returns "" precisely because the
    // value really did render no text, which is what the stand-in says.
    const silent: unknown[] = [
      new Error(""),
      "   ",
      "\n\t",
      { toString: () => "  " },
      Object.create(null) as unknown,
      {
        toString: () => {
          throw new Error("hostile");
        },
      },
    ];

    // One stand-in for all six, so a degraded report that merely happened to
    // render something is distinguishable from the stand-in itself.
    const lines = new Set<string>();

    for (const empty of silent) {
      vi.resetModules();
      write.mockClear();
      breakFormatter();
      rejectWith(empty);

      await (await load())();

      // Asserted before the argument is read, and read without `String()`
      // around it, for the reason the sibling loop gives: dropping the stand-in
      // in the write-NOTHING direction leaves `mock.calls` empty, and
      // `String(undefined)` is non-blank to `.trim().length`.
      expect(write).toHaveBeenCalledTimes(1);
      const reported = write.mock.calls[0]?.[0] as string;

      expect(reported.trim().length).toBeGreaterThan(0);
      expect(reported.endsWith("\n")).toBe(true);
      lines.add(reported);
    }

    expect(lines.size).toBe(1);
    expect([...lines][0]).toContain("MCP server");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("does not reach for the formatter on the success path", async () => {
    // The falsifier for hoisting the `@lhremote/core` import out of the catch —
    // the shape that looks tidier and puts the formatter back in front of the
    // failure it is meant to describe.  A normal start must not ask for it at
    // all: `./stdio.js` pulls it in anyway, so asking early saves nothing and
    // costs the coverage.
    const loaded = vi.fn();

    vi.doMock("@lhremote/core", () => {
      loaded();
      return { errorMessage: (error: unknown) => String(error) };
    });
    vi.doMock("./stdio.js", () => ({
      runStdioServer: vi.fn().mockResolvedValue(undefined),
    }));

    await (await load())();

    expect(loaded).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});
