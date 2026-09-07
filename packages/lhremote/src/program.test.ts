// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProgram as createBaseProgram } from "@lhremote/cli";

import { createProgram } from "./program.js";

const runStdioServer = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@lhremote/mcp/stdio", () => ({ runStdioServer }));

describe("lhremote meta-package CLI", () => {
  beforeEach(() => {
    runStdioServer.mockClear();
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

  it("does not add mcp to the base @lhremote/cli program itself", () => {
    expect(createBaseProgram().commands.map((c) => c.name())).not.toContain("mcp");
  });

  it("starts the stdio MCP server when mcp is invoked", async () => {
    await createProgram().parseAsync(["mcp"], { from: "user" });

    expect(runStdioServer).toHaveBeenCalledTimes(1);
  });
});
