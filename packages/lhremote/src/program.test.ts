// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProgram as createBaseProgram } from "@lhremote/cli";

import { createProgram } from "./program.js";

const runStdioServer = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@lhremote/mcp/stdio", () => ({ runStdioServer }));

describe("lhremote meta-package CLI", () => {
  beforeEach(() => {
    runStdioServer.mockClear();
  });

  afterEach(() => {
    // The last test re-registers this specifier with a counting factory of its
    // own. Put the file's own mock back rather than unmocking: `vi.doUnmock`
    // would delete the hoisted `vi.mock` above from the registry for the rest
    // of the file, so a shuffled run would then load the REAL MCP server.
    vi.doMock("@lhremote/mcp/stdio", () => ({ runStdioServer }));
    vi.resetModules();
  });

  it("composes the @lhremote/cli program with an mcp subcommand", () => {
    const commandNames = createProgram()
      .commands.map((c) => c.name())
      .filter((n) => n === "mcp");

    expect(commandNames).toEqual(["mcp"]);
  });

  it("keeps every command the base @lhremote/cli program provides", () => {
    const baseNames = createBaseProgram()
      .commands.map((c) => c.name())
      .sort();
    const composedNames = createProgram()
      .commands.map((c) => c.name())
      .sort();

    expect(baseNames.length).toBeGreaterThan(0);
    expect(composedNames).toEqual([...baseNames, "mcp"].sort());
  });

  it("preserves the base program's name and version", () => {
    // A future createProgram() that built a fresh Command and copied the
    // subcommands across would satisfy the command-set assertions above while
    // silently dropping .name()/.version(), breaking `lhremote --version`.
    const base = createBaseProgram();
    const composed = createProgram();

    expect(composed.name()).toBe("lhremote");
    expect(composed.name()).toBe(base.name());
    expect(composed.version()).toBe(base.version());
    expect(composed.version()).toBeTruthy();
  });

  it("does not add mcp to the base @lhremote/cli program itself", () => {
    expect(createBaseProgram().commands.map((c) => c.name())).not.toContain("mcp");
  });

  it("starts the stdio MCP server when mcp is invoked", async () => {
    await createProgram().parseAsync(["mcp"], { from: "user" });

    expect(runStdioServer).toHaveBeenCalledTimes(1);
  });

  it("does not load the MCP server module merely by building the program", async () => {
    // #963 at unit level, and the falsifier for moving that `import()` back to
    // module scope.  `@lhremote/mcp/stdio` must be loaded by the `mcp` ACTION,
    // not by importing `./program.js`: a static import evaluates the whole MCP
    // graph whenever this module is imported — so `lhremote --version` paid for
    // it — and a module-scope throw under it then escaped into the ESM loader
    // as a crash dump, before `runProgramBin`'s catch existed.  Measured on the
    // built `lhremote` bin with `packages/mcp`'s own
    // `require("../package.json")` forced to fail: a 24-line dump before, three
    // lines after — Node renders `MODULE_NOT_FOUND` with its own require stack
    // and `errorMessage` renders that message whole, so the count belongs to
    // the error and what the fix decides is that nothing else is printed.
    // `--version` stopped failing at all, because it no longer loads that
    // graph.
    //
    // The counter is registered with `vi.doMock` HERE rather than read off the
    // hoisted `vi.mock` above, and that is not a style choice: `vi.resetModules`
    // does not clear the mocker registry, so a hoisted factory runs ONCE for the
    // whole file and never again — its count stays 0 after a reset no matter
    // what is imported, which makes "never loaded" pass vacuously.  Measured:
    // the first draft of this test did exactly that, and only the positive
    // control at the bottom caught it.  A fresh `doMock` is a new registry
    // entry, so it runs on the next import.
    const loaded = vi.fn();

    vi.resetModules();
    vi.doMock("@lhremote/mcp/stdio", () => {
      loaded();
      return { runStdioServer };
    });

    const fresh = (await import("./program.js")).createProgram;

    // A static specifier would already have fired the factory on the line
    // above, while `./program.js` was evaluating.
    expect(loaded).not.toHaveBeenCalled();

    fresh();

    // Building the program registers the subcommand; it must not run its body.
    expect(loaded).not.toHaveBeenCalled();

    // The positive control, without which "never loaded" would also pass for a
    // mock that never registered — a renamed or mis-resolved specifier looks
    // exactly like a module that was not reached.
    await fresh().parseAsync(["mcp"], { from: "user" });

    expect(loaded).toHaveBeenCalledTimes(1);
    expect(runStdioServer).toHaveBeenCalledTimes(1);
  });
});
