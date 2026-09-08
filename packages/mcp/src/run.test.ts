// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { runStdioBin } from "./run.js";

const { runStdioServer } = vi.hoisted(() => ({ runStdioServer: vi.fn() }));
vi.mock("./stdio.js", () => ({ runStdioServer }));

/**
 * Warm the formatter's module graph outside any test's own budget.
 *
 * `./stdio.js` is mocked just above, so nothing in this file loads
 * `@lhremote/core` the way the real bin does.  `runStdioBin`'s catch is
 * therefore the first thing to import it, and the whole cold load lands inside
 * whichever test reaches the catch first — a cost the bin itself never pays,
 * because there `./stdio.js` has already pulled core in and the import in
 * `render` is a cache hit.
 *
 * The cost is not small: it is the same ~274-module graph this change exists to
 * put behind the catch.  Measured cold at ~330ms here and at over five seconds
 * on the Windows CI runner, where it timed out `reports a rejecting startup on
 * stderr and exits non-zero` against vitest's 5s default while every other test
 * in the file ran in milliseconds.  Whichever test reaches the catch first pays
 * it, so `--sequence.shuffle` moves the failure rather than removing it.
 *
 * Warming charges it to a hook instead, and nothing is mocked away to get
 * there — these tests assert what the real `errorMessage` renders, so the load
 * is necessary and only its accounting was wrong.  `beforeAll` rather than
 * `beforeEach` because it survives the `vi.resetModules()` the second block
 * runs in teardown: measured, a post-reset re-import costs ~6ms against ~330ms
 * cold, so the reset re-wires the registry rather than re-executing the graph.
 */
beforeAll(async () => {
  await import("@lhremote/core");
}, 120_000);

/**
 * The coverage the bin entrypoint itself cannot carry.
 * `packages/mcp/src/index.ts` is excluded from the coverage gate as a bin
 * entrypoint — it starts a server at module scope, so importing it runs the
 * program instead of testing it — which is why the rejection path lives in
 * `run.ts` and not there (#945).  This measures it.
 *
 * `runStdioServer` is mocked rather than driven for real, and not because it
 * never returns — it resolves, once the server is serving and the signal
 * handlers are registered, which is what the last test here pins.  It is that
 * `StdioServerTransport.start()` has by then attached a ref'd `data` listener
 * to `process.stdin`, and that handle would keep the worker alive.  What is
 * under test is not that function but what this module does with the three
 * failures that can escape it.  (`stdio.ts` itself is measured at zero — no
 * suite drives it, in any tier.  A separate gap, named here so this file is
 * not read as covering it.)
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
      // Both handles cleared per iteration, not just `write`: asserting `exit`
      // once after the loop would be satisfied by a regression that exited for
      // the first value and not the rest.
      write.mockClear();
      exit.mockClear();
      runStdioServer.mockRejectedValue(empty);

      await runStdioBin();
      expect(exit).toHaveBeenCalledWith(1);

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
 * Two vitest properties shape what is written here.
 *
 * A `vi.doMock` factory that throws does not reject with the thrown value:
 * `createHelpfulError` wraps it in an error about mocking — but it assigns the
 * original as `cause`, which `errorMessage` renders as a `Caused by:` line.  So
 * the thrown text IS assertable through a broken graph, as long as the
 * formatter is left intact, and the case below that does so asserts on it.
 * Where the formatter is deliberately broken too, only the report's shape can
 * be asserted, because `lastResortMessage` reads the head and the head is
 * vitest's.
 *
 * And `vi.resetModules()` does not clear the mocker registry, so teardown has
 * to unmock deliberately — but only one of the two specifiers.  See the
 * `afterEach` below; getting that asymmetry wrong is what a bare shape
 * assertion cannot see, and it cost one round here.
 *
 * What none of this reproduces is a real ESM instantiation failure — no
 * in-process mock can. That was measured against the built bin and recorded in
 * the commit, and it is not re-run by this suite.
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
    // Asymmetric on purpose, and both halves were measured. `@lhremote/core`
    // MUST be unmocked: `vi.resetModules()` does not clear the mocker
    // registry, so a `breakFormatter()` from one test otherwise leaves the
    // formatter broken for every test after it — which silently turns the
    // undegraded cases into degraded ones that still pass on shape.
    // `./stdio.js` is RE-REGISTERED rather than unmocked: unmocking it deletes
    // the hoisted `vi.mock` on line 9 from the suite's registry for the rest of
    // the file, and leaving this block's per-test mock standing was measured to
    // fail the FIRST block under `--sequence.shuffle`.  Re-registering puts the
    // file back the way it started on both counts — and it is what makes a
    // per-test `vi.doUnmock("./stdio.js")` safe, which the causal case needs.
    vi.doUnmock("@lhremote/core");
    vi.doMock("./stdio.js", () => ({ runStdioServer }));
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("evaluates with its whole graph broken, so a throw cannot outrun the catch", async () => {
    // A structural falsifier for the fix, and the only test here that asserts
    // on the *import* rather than on a call.  Restore either specifier to a
    // static `import` at the top of `run.ts` and THIS line rejects: the module
    // never finishes evaluating, `runStdioBin` never exists to be called, and
    // the throw is back in the loader's hands.  Deliberately not written as
    // "the source has no static imports" — that is a fact about text, and what
    // has to hold is a fact about loading it.
    //
    // Every edit that reddens this also reddens a sibling below, so it earns
    // its place as a statement of the invariant rather than as unique cover.
    vi.doMock("./stdio.js", () => {
      throw new Error("server graph failed");
    });
    breakFormatter();

    const module = await import("./run.js");

    expect(typeof module.runStdioBin).toBe("function");
  });

  it("reports a rejecting server import rather than letting it escape", async () => {
    // #959's own case. The formatter is left intact, which is also what makes
    // the thrown text assertable: vitest's wrapper carries it as `cause` and
    // `errorMessage` renders the chain. Without that assertion a `render` that
    // returned "" unconditionally would still pass — UNREPORTABLE is non-blank,
    // newline-terminated and exits 1 like any other report.
    vi.doMock("./stdio.js", () => {
      throw new Error("server graph failed");
    });

    await (await load())();

    expect(write).toHaveBeenCalledTimes(1);
    const reported = write.mock.calls[0]?.[0] as string;
    expect(reported).toContain("server graph failed");
    expect(reported.endsWith("\n")).toBe(true);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("degrades when the formatter is the module that failed, not only when told to", async () => {
    // The causal case, and the one the arranged cases below cannot make. Only
    // `@lhremote/core` is broken here; `./stdio.js` is REAL, so it is the
    // genuine `import { errorMessage } from "@lhremote/core"` at the top of
    // `stdio.ts` that fails, and `render`'s re-import then hits the same
    // failure rather than succeeding.
    //
    // This is what the `lastResortMessage` docstring claims and what every
    // other test here assumes: break the formatter and the server import
    // breaks with it, so the degraded path is reached by cause and not by
    // construction. If the re-import could somehow succeed, this test would
    // report through `errorMessage` and the whole fallback would be dead code.
    //
    // The unmock is the whole test: without it `./stdio.js` is the hoisted
    // mock, whose factory imports nothing, and breaking the formatter would
    // not break the server import at all. `afterEach` re-registers it.
    vi.doUnmock("./stdio.js");
    breakFormatter();

    await (await load())();

    expect(write).toHaveBeenCalledTimes(1);
    const reported = write.mock.calls[0]?.[0] as string;
    expect(reported.trim().length).toBeGreaterThan(0);
    expect(reported.endsWith("\n")).toBe(true);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("keeps the error's own text when the formatter is what failed", async () => {
    // The path `lastResortMessage` exists for. Printing the no-message stand-in
    // here would be a false statement about an error that plainly carried one.
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

  it("survives an Error whose message is not a string", async () => {
    // `Error.message` is typed `string` and nothing enforces it at runtime.
    // Returning it unconverted would throw on the caller's `.trim()` — inside
    // the catch, with no handler left — so the rejection would escape
    // `runStdioBin` and reach the bin as the crash dump this file exists to
    // prevent. `errorMessage` threw on this input for the same reason once
    // (measured: `ownText(...).trim is not a function`), and #965 closed that
    // by coercing: it renders `"42"` now, so `render` returns from its own
    // `try` and the formatter is deliberately NOT broken here.  What this
    // pins end-to-end is therefore the undegraded path — `render`'s catch is
    // not reached.  The coercion the paragraph above is about,
    // `lastResortMessage`'s `String()` over a non-string `Error.message`, is
    // left uncovered here: the cases that do reach `render`'s catch get there
    // through `breakFormatter()`, which stands in for the formatter failing
    // to LOAD, and none of them carries such a message.
    const hostile = new Error("placeholder");
    Object.defineProperty(hostile, "message", { value: 42 });
    rejectWith(hostile);

    await expect((await load())()).resolves.toBeUndefined();

    expect(write).toHaveBeenCalledWith("42\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("drops the cause chain when the formatter is unavailable, and says the head", async () => {
    // The documented cost of the degraded path, pinned so it is a decision and
    // not a surprise: `errorMessage` renders `Caused by:` lines and
    // `lastResortMessage` cannot, because recovering them would mean a second
    // formatter in a tree that refuses one. The undegraded behaviour is held by
    // the first block, so the two together say which half is lost.
    breakFormatter();
    rejectWith(new Error("could not start", { cause: new Error("EADDRINUSE") }));

    await (await load())();

    expect(write).toHaveBeenCalledWith("could not start\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("still says something when the formatter is gone and the value renders nothing", async () => {
    // The degraded twin of the `errorMessage` loop above, and not a copy of it.
    // `new Error("   ")` is here and not there because it is the one value the
    // two formatters treat differently: `errorMessage` trims its own head,
    // `lastResortMessage` does not, so this is the only case where the caller's
    // `.trim()` is load-bearing on the Error branch. The last two are the only
    // values in this file that reach `lastResortMessage`'s own catch —
    // `String()` is a call, not a coercion that always succeeds, so a
    // prototype-less value and a throwing `toString` both land there.
    // (`Object.create(null)` also appears in the first loop, where it takes
    // `errorMessage`'s catch instead. Same value, different guard.)
    const silent: unknown[] = [
      new Error(""),
      new Error("   "),
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

    // One stand-in for all of them, so a degraded report that merely happened
    // to render something is distinguishable from the stand-in itself.
    const lines = new Set<string>();

    for (const empty of silent) {
      vi.resetModules();
      write.mockClear();
      exit.mockClear();
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
      // Per iteration, not once after the loop: a regression that exited for
      // the first value and not the rest would satisfy a trailing assertion.
      expect(exit).toHaveBeenCalledWith(1);
      lines.add(reported);
    }

    expect(lines.size).toBe(1);
    expect([...lines][0]).toContain("MCP server");
  });

  it("does not reach for the formatter on the success path", async () => {
    // The falsifier for hoisting the `@lhremote/core` import out of the catch —
    // the shape that looks tidier and puts the formatter back in front of the
    // failure it is meant to describe. A normal start must not ask for it at
    // all: `./stdio.js` pulls it in anyway, so asking early saves nothing and
    // costs the coverage.
    const loaded = vi.fn();
    const runStdioServer = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("boom"));

    vi.doMock("@lhremote/core", () => {
      loaded();
      return { errorMessage: (error: unknown) => String(error) };
    });
    vi.doMock("./stdio.js", () => ({ runStdioServer }));

    const fresh = await load();
    await fresh();

    expect(loaded).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    // The positive control, without which "never called" would also pass for a
    // mock that never registered — a renamed or mis-resolved specifier looks
    // exactly like a formatter that was not reached.
    await fresh();

    expect(loaded).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
