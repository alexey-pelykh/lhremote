// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runProgram } from "./run.js";

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
    // `errorMessage` returns "" for both of these.  Without a stand-in the
    // operator would get a bare newline and exit 1 — a failure with no
    // diagnosis at the one boundary that has no prefix of its own.
    for (const empty of [new Error(""), Object.create(null) as unknown]) {
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
