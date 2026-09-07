// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runProgram } from "./run.js";

/**
 * These are the coverage the bin entrypoints themselves cannot carry.  Both
 * `packages/{cli,lhremote}/src/cli.ts` are excluded from the coverage gate as
 * bin entrypoints, so the rejection path had to live somewhere measurable for
 * anything to observe it at all (#933).  That is `run.ts`, and this is it.
 */
describe("runProgram", () => {
  const originalArgv = process.argv;

  /** A one-subcommand program whose action is the thing under test. */
  function programRunning(action: () => Promise<void>): Command {
    const program = new Command();
    program.name("test-cli").exitOverride();
    program.command("go").action(action);
    return program;
  }

  beforeEach(() => {
    process.argv = ["node", "test-cli", "go"];
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("awaits an async action to completion before resolving", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
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
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await runProgram(
      programRunning(() =>
        Promise.reject(new Error("Failed to start MCP server: boom")),
      ),
    );

    expect(write).toHaveBeenCalledWith(
      "Failed to start MCP server: boom\n",
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("reports a synchronous throw from inside an async action", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    // The shape the issue names as actually reachable: `createServer()` or
    // `new StdioServerTransport()` throwing before anything is awaited.
    await runProgram(
      programRunning(() => {
        throw new Error("transport unavailable");
      }),
    );

    expect(write).toHaveBeenCalledWith("transport unavailable\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("renders a non-Error rejection through errorMessage", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await runProgram(
      programRunning(() => Promise.reject("bare string rejection")),
    );

    expect(write).toHaveBeenCalledWith("bare string rejection\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("renders a cause chain, so a wrapped failure keeps its origin", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);

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
});
