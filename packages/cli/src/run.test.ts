// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { Command } from "commander";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { runProgram } from "./run.js";

/**
 * Warm the formatter's module graph outside any test's own budget.
 *
 * Newly necessary in #963, and it is the change to `run.ts` that makes it so.
 * That module used to `import { errorMessage } from "@lhremote/core"` at its
 * top, so importing it here warmed core before any test ran.  It no longer
 * does — that static import is exactly what evaluated core ahead of the catch —
 * so core is now COLD in this file, and the whole load lands inside whichever
 * test first reaches the reporting path.
 *
 * `packages/mcp/src/run.test.ts` hit this before us and documents what it
 * costs there: ~330ms locally and over five seconds on the Windows CI runner,
 * where it timed out a single test against vitest's 5s default while every
 * other test in the file ran in milliseconds.  That is a measurement of that
 * file, cited rather than re-derived.  What was measured HERE, at `bc5578b`
 * from `packages/cli`: the same graph costs ~50ms cold in plain node and
 * ~0.03ms warm, and inside vitest the first test to reach the catch is the one
 * that pays whatever the transform pipeline adds on top.
 *
 * Charging it to a hook instead makes the accounting right without mocking
 * anything away — these tests assert what the real `errorMessage` renders, so
 * the load is necessary and only its placement was wrong.  `beforeAll` rather
 * than `beforeEach` because it survives the `vi.resetModules()` the second
 * block runs in teardown: a post-reset re-import re-wires the registry rather
 * than re-executing the graph.
 */
beforeAll(async () => {
  await import("@lhremote/core");
}, 120_000);

/**
 * The coverage the bin entrypoints themselves cannot carry.  Both
 * `packages/{cli,lhremote}/src/cli.ts` are excluded from the coverage gate as
 * bin entrypoints, so the rejection path had to live somewhere measurable for
 * anything to observe it at all (#933).  That is `run.ts`, and this is it.
 */
describe("runProgram", () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  let exit: ReturnType<typeof vi.spyOn>;
  let write: ReturnType<typeof vi.spyOn>;

  /**
   * A program whose single subcommand's action is the thing under test.
   *
   * `exitOverride()` is deliberate and it INVERTS PRODUCTION: `createProgram()`
   * never sets it, so commander really does call `process.exit()` for its own
   * failures.  Here it keeps a malformed argv from tearing down the vitest
   * worker.  The `commander stays out of the catch` block below is the one
   * that must not use this fixture, and does not.
   */
  function programRunning(action: () => Promise<void>): Command {
    const program = new Command();
    program.name("test-cli").exitOverride();
    program.command("go").action(action);
    return program;
  }

  beforeEach(() => {
    process.argv = ["node", "test-cli", "go"];
    process.exitCode = undefined;
    exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("awaits an async action to completion before resolving", async () => {
    let finished = false;

    // The `await` on a timer is the falsifier: commander's synchronous
    // `.parse()` returns before this line runs, so `finished` would still be
    // false here.  Only an awaited `parseAsync()` makes it true.
    await runProgram(
      programRunning(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        finished = true;
      }),
    );

    expect(finished).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("reports a rejecting async action on stderr and exits non-zero", async () => {
    await runProgram(
      programRunning(() => Promise.reject(new Error("transport unavailable"))),
    );

    expect(write).toHaveBeenCalledWith("transport unavailable\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("reports a synchronous throw from inside an action", async () => {
    // The shape the issue names as actually reachable: `createServer()` or
    // `new StdioServerTransport()` throwing before anything is awaited.
    await runProgram(
      programRunning(() => {
        throw new Error("createServer failed");
      }),
    );

    expect(write).toHaveBeenCalledWith("createServer failed\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("renders a non-Error rejection through errorMessage", async () => {
    await runProgram(
      programRunning(() => Promise.reject("bare string rejection")),
    );

    expect(write).toHaveBeenCalledWith("bare string rejection\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("renders a cause chain, so a wrapped failure keeps its origin", async () => {
    await runProgram(
      programRunning(() =>
        Promise.reject(
          new Error("could not start", { cause: new Error("EADDRINUSE") }),
        ),
      ),
    );

    const reported = write.mock.calls[0]?.[0];
    expect(reported).toContain("could not start");
    expect(reported).toContain("EADDRINUSE");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("still says something when the error renders no message", async () => {
    // Without a stand-in each of these would print a blank line and exit 1 —
    // a failure with no diagnosis, at the one boundary that has no prefix of
    // its own.  The first two render "" outright.  The whitespace cases are
    // the ones a bare `length > 0` test lets through:
    // `errorMessage` does not trim a non-`Error` value, so a rejected "   "
    // comes back as three spaces — blank to a reader, non-empty to `length`.
    const silent: unknown[] = [
      new Error(""),
      Object.create(null) as unknown,
      "   ",
      "\n\t",
      { toString: () => "  " },
    ];

    for (const empty of silent) {
      write.mockClear();

      await runProgram(programRunning(() => Promise.reject(empty)));

      const reported = String(write.mock.calls[0]?.[0]);
      expect(reported.trim().length).toBeGreaterThan(0);
    }

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits non-zero even when reporting to stderr itself fails", async () => {
    // A failing `process.stderr.write` is one of the paths #933 names.  It
    // must not reject out of the function whose whole job is to report.
    write.mockImplementation(() => {
      throw new Error("EPIPE");
    });

    await expect(
      runProgram(programRunning(() => Promise.reject(new Error("boom")))),
    ).resolves.toBeUndefined();

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("leaves an exit code a normally-returning handler set", async () => {
    // The shape nearly every handler in ./handlers/ uses: catch internally,
    // set process.exitCode, return normally.  It must not enter the catch.
    await runProgram(
      programRunning(async () => {
        await Promise.resolve();
        process.exitCode = 1;
      }),
    );

    expect(process.exitCode).toBe(1);
    expect(write).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  describe("commander stays out of the catch", () => {
    /**
     * Built WITHOUT `exitOverride()`, which is how production programs are
     * built.  Commander resolves these itself and calls `process.exit()`
     * before the promise settles, so `runProgram` never sees them — which is
     * what leaves `--help` and `--version` output unchanged by this change.
     *
     * The assertion is on the FIRST `process.exit` call, and that is not
     * squeamishness: a mocked `process.exit` returns instead of terminating,
     * so commander runs on past it and the tail of each run is an artifact of
     * the mock, not of production.  The first call is the real observable —
     * commander's own 0.  Were commander's failures routed through the catch
     * instead (which is what setting `exitOverride()` on `createProgram()`
     * would do), the first call would be this module's 1, and these fail.
     */
    function productionShapedProgram(): Command {
      const program = new Command();
      program.name("test-cli").version("9.9.9");
      program.command("go").action(() => Promise.resolve());
      return program;
    }

    it("does not report --help as an error", async () => {
      const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      process.argv = ["node", "test-cli", "--help"];

      await runProgram(productionShapedProgram());

      expect(exit.mock.calls[0]).toEqual([0]);
      expect(String(stdout.mock.calls[0]?.[0])).toContain("Usage: test-cli");
    });

    it("does not report --version as an error", async () => {
      const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      process.argv = ["node", "test-cli", "--version"];

      await runProgram(productionShapedProgram());

      expect(exit.mock.calls[0]).toEqual([0]);
      expect(String(stdout.mock.calls[0]?.[0])).toContain("9.9.9");
    });
  });
});

/**
 * The half of the contract the suite above cannot reach.
 *
 * Every test above drives `runProgram` through the module instance this file
 * imported statically, and hands it a program that is already built — so all of
 * them are about what happens *after* the graph has evaluated.  #963 is about
 * what happens *during* it: a throw at module scope anywhere under
 * `./program.js` used to run to completion before any catch existed, because
 * the bins imported `createProgram` statically and called it outside the `try`.
 * That is why these re-import `./run.js` per case with the graph broken
 * deliberately, and why they use `vi.doMock` with `vi.resetModules` rather than
 * a file-level `vi.mock`: the mock has to differ per test, and the module under
 * test has to be evaluated fresh under each one.
 *
 * The thunk is what makes the difference testable at all.  `runProgramBin`
 * takes `() => Promise<Command>` and INVOKES it inside its `try`, so the tests
 * below can pass the very thunk the bins pass — `async () => (await
 * import("./program.js")).createProgram()` — and break either half of it.
 * `runProgram`, which takes a built `Command`, cannot express that.
 *
 * Two vitest properties shape what is written here, both inherited from
 * `packages/mcp/src/run.test.ts` rather than rediscovered.
 *
 * A `vi.doMock` factory that throws does not reject with the thrown value:
 * `createHelpfulError` wraps it in an error about mocking — but it assigns the
 * original as `cause`, which `errorMessage` renders as a `Caused by:` line.  So
 * the thrown text IS assertable through a broken graph, as long as the
 * formatter is left intact, and the cases below that do so assert with
 * `toContain` rather than on the whole line.  A factory that RETURNS a module
 * whose function throws is not wrapped at all, so those cases assert exactly.
 *
 * And `vi.resetModules()` does not clear the mocker registry, so teardown has
 * to unmock deliberately or a `breakFormatter()` from one test leaves the
 * formatter broken for every test after it — which silently turns the
 * undegraded cases into degraded ones that still pass on shape.  Both
 * specifiers are unmocked symmetrically here, which is simpler than the mcp
 * file's asymmetry: this file registers no file-level `vi.mock` for either.
 *
 * What none of this reproduces is a real ESM instantiation failure — no
 * in-process mock can.  That was measured against both built bins with a
 * module-scope `require("../package.json")` forced to fail, and recorded in the
 * commit: a 24-line crash dump before, one diagnosed line after, exit 1 either
 * way.  It is not re-run by this suite.
 */
describe("runProgramBin — import-graph coverage", () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  let exit: ReturnType<typeof vi.spyOn>;
  let write: ReturnType<typeof vi.spyOn>;

  /** Stands in for `@lhremote/core` being the module that failed to evaluate. */
  const breakFormatter = () => {
    vi.doMock("@lhremote/core", () => {
      throw new Error("core graph failed");
    });
  };

  /**
   * The thunk `packages/{cli,lhremote}/src/cli.ts` actually pass, verbatim.
   *
   * Written out rather than imported so that a change to the bins' idiom shows
   * up here as a difference to reconcile rather than as a silent follow.
   */
  const productionThunk = async (): Promise<Command> =>
    (await import("./program.js")).createProgram();

  /** Stands in for a program that builds, then fails once argv is parsed. */
  const programRejecting = (value: unknown) => async (): Promise<Command> => {
    const program = new Command();
    program.name("test-cli").exitOverride();
    program.command("go").action(() => Promise.reject(value));
    return program;
  };

  const load = async () => (await import("./run.js")).runProgramBin;

  beforeEach(() => {
    process.argv = ["node", "test-cli", "go"];
    process.exitCode = undefined;
    vi.resetModules();
    exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    // `vi.resetModules()` does not clear the mocker registry, so a per-test
    // `doMock` outlives the test that set it unless it is removed here.
    vi.doUnmock("@lhremote/core");
    vi.doUnmock("./program.js");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("evaluates with its whole graph broken, so a throw cannot outrun the catch", async () => {
    // A structural falsifier for the fix, and the only test here that asserts
    // on the *import* rather than on a call.  Restore
    // `import { errorMessage } from "@lhremote/core"` to the top of `run.ts`
    // and THIS line rejects: the module never finishes evaluating,
    // `runProgramBin` never exists to be called, and the throw is back in the
    // loader's hands.  Deliberately not written as "the source has no static
    // imports" — that is a fact about text, and what has to hold is a fact
    // about loading it.
    //
    // Every edit that reddens this also reddens a sibling below, so it earns
    // its place as a statement of the invariant rather than as unique cover.
    vi.doMock("./program.js", () => {
      throw new Error("program graph failed");
    });
    breakFormatter();

    const module = await import("./run.js");

    expect(typeof module.runProgramBin).toBe("function");
    // The public entry has to survive the same evaluation, or `program.ts`'s
    // re-export of it breaks for every consumer.
    expect(typeof module.runProgram).toBe("function");
  });

  it("reports a failing program import rather than letting it escape", async () => {
    // #963's own case, and the one the built-bin measurement forces for real:
    // a module-scope throw under `./program.js`.  The formatter is left intact,
    // which is also what makes the thrown text assertable — vitest's wrapper
    // carries it as `cause` and `errorMessage` renders the chain.  Without that
    // assertion a `render` that returned "" unconditionally would still pass,
    // since UNREPORTABLE is non-blank, newline-terminated and exits 1 like any
    // other report.
    vi.doMock("./program.js", () => {
      throw new Error("program graph failed");
    });

    await (await load())(productionThunk);

    expect(write).toHaveBeenCalledTimes(1);
    const reported = write.mock.calls[0]?.[0] as string;
    expect(reported).toContain("program graph failed");
    expect(reported.endsWith("\n")).toBe(true);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("reports a throw from createProgram() itself", async () => {
    // AC-2 at unit level.  `./program.js` LOADS here — the factory returns a
    // module rather than throwing — and the throw comes from calling
    // `createProgram()`.  That call was made by the bin, outside the `try`,
    // until #963; it is inside the thunk now, so it is covered.  Asserted
    // exactly rather than with `toContain`: a returning factory is not wrapped
    // by `createHelpfulError`, so this is the error's own text.
    vi.doMock("./program.js", () => ({
      createProgram: () => {
        throw new Error("createProgram failed");
      },
    }));

    await (await load())(productionThunk);

    expect(write).toHaveBeenCalledWith("createProgram failed\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("degrades when the formatter is the module that failed, not only when told to", async () => {
    // The causal case, and the one the arranged cases below cannot make.  Only
    // `@lhremote/core` is broken here; `./program.js` is REAL, so it is the
    // genuine chain `program.ts` -> `./handlers/index.js` -> `@lhremote/core`
    // that fails, and `render`'s re-import then hits the same failure rather
    // than succeeding.  75 of the 77 non-test files under `./handlers/` import
    // core directly (measured at `bc5578b`), so this is not a narrow path.
    //
    // This is what the `lastResortMessage` docstring claims and what every
    // other test here assumes: break the formatter and the program import
    // breaks with it, so the degraded path is reached by cause and not by
    // construction.  If the re-import could somehow succeed, this test would
    // report through `errorMessage` and the whole fallback would be dead code.
    breakFormatter();

    await (await load())(productionThunk);

    expect(write).toHaveBeenCalledTimes(1);
    const reported = write.mock.calls[0]?.[0] as string;
    expect(reported.trim().length).toBeGreaterThan(0);
    expect(reported.endsWith("\n")).toBe(true);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("keeps the error's own text when the formatter is what failed", async () => {
    // The path `lastResortMessage` exists for.  Printing the no-message
    // stand-in here would be a false statement about an error that plainly
    // carried one.
    breakFormatter();

    await (await load())(programRejecting(new Error("EPIPE")));

    expect(write).toHaveBeenCalledWith("EPIPE\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("renders a non-Error value when the formatter is unavailable", async () => {
    breakFormatter();

    await (await load())(programRejecting("bare string rejection"));

    expect(write).toHaveBeenCalledWith("bare string rejection\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("drops the cause chain when the formatter is unavailable, and says the head", async () => {
    // The documented cost of the degraded path, pinned so it is a decision and
    // not a surprise: `errorMessage` renders `Caused by:` lines and
    // `lastResortMessage` cannot, because recovering them would mean a second
    // formatter in a tree that refuses one.  The undegraded behaviour is held
    // by `renders a cause chain` in the first block, so the two together say
    // which half is lost.
    breakFormatter();

    await (await load())(
      programRejecting(
        new Error("could not start", { cause: new Error("EADDRINUSE") }),
      ),
    );

    expect(write).toHaveBeenCalledWith("could not start\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("survives an Error whose message is not a string", async () => {
    // `Error.message` is typed `string` and nothing enforces it at runtime.
    // Returning it unconverted would throw on `report`'s `.trim()` — inside the
    // catch, with no handler left — so the rejection would escape
    // `runProgramBin` and reach the bin as the crash dump this block exists to
    // prevent.  The formatter is broken deliberately, because that is what
    // routes the value through `lastResortMessage`'s `String()`, which is the
    // coercion under test here.
    const hostile = new Error("placeholder");
    Object.defineProperty(hostile, "message", { value: 42 });
    breakFormatter();

    await expect(
      (await load())(programRejecting(hostile)),
    ).resolves.toBeUndefined();

    expect(write).toHaveBeenCalledWith("42\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("still says something when the formatter is gone and the value renders nothing", async () => {
    // The degraded twin of the `errorMessage` loop in the first block, and not
    // a copy of it.  `new Error("   ")` is here and not there because it is the
    // one value the two formatters treat differently: `errorMessage` trims its
    // own head, `lastResortMessage` does not, so this is the only case where
    // `report`'s `.trim()` is load-bearing on the Error branch.  The last two
    // are the only values in this file that reach `lastResortMessage`'s own
    // catch — `String()` is a call, not a coercion that always succeeds, so a
    // prototype-less value and a throwing `toString` both land there.
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

      await (await load())(programRejecting(empty));

      // Asserted before the argument is read, and read without `String()`
      // around it: dropping the stand-in in the write-NOTHING direction leaves
      // `mock.calls` empty, and `String(undefined)` is non-blank to
      // `.trim().length`.
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
    // Names THIS program, not the MCP one.  The two stand-ins are deliberately
    // different strings because the two bins fail at different things, and a
    // copy-paste that brought the wrong one across would otherwise pass every
    // other assertion here.
    expect([...lines][0]).toContain("Command failed");
    expect([...lines][0]).not.toContain("MCP server");
  });

  it("exits non-zero even when reporting to stderr itself fails", async () => {
    // The guarded write, on the graph-coverage path rather than the first
    // block's. A failing `process.stderr.write` must not reject out of the one
    // function whose whole job is to report.
    vi.doMock("./program.js", () => {
      throw new Error("program graph failed");
    });
    write.mockImplementation(() => {
      throw new Error("EPIPE");
    });

    await expect((await load())(productionThunk)).resolves.toBeUndefined();

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("reports nothing and does not exit on the success path", async () => {
    const program = new Command();
    program.name("test-cli").exitOverride();
    program.command("go").action(() => Promise.resolve());

    await (await load())(async () => program);

    expect(write).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("does not reach for the formatter on the success path", async () => {
    // The falsifier for hoisting the `@lhremote/core` import out of `render` —
    // the shape that looks tidier and puts the formatter back in front of the
    // failure it is meant to describe.  A normal run must not ask for it at
    // all: `./program.js` pulls it in anyway, so asking early saves nothing and
    // costs the coverage.
    const loaded = vi.fn();
    vi.doMock("@lhremote/core", () => {
      loaded();
      return { errorMessage: (error: unknown) => String(error) };
    });

    const program = new Command();
    program.name("test-cli").exitOverride();
    program.command("go").action(() => Promise.resolve());

    const fresh = await load();
    await fresh(async () => program);

    expect(loaded).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    // The positive control, without which "never called" would also pass for a
    // mock that never registered — a renamed or mis-resolved specifier looks
    // exactly like a formatter that was not reached.
    await fresh(programRejecting(new Error("boom")));

    expect(loaded).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
