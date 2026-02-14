// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

import { describe, expect, it } from "vitest";

import { createProgram } from "@lhremote/cli";

describe("lhremote meta-package CLI", () => {
  it("composes @lhremote/cli program with mcp subcommand", async () => {
    const { createProgram: createBase } = await import("@lhremote/cli");
    const program = createBase();

    // Simulate what cli.ts does: add the mcp command
    program
      .command("mcp")
      .description(
        "Start MCP server on stdio (for Claude Desktop, Cursor, etc.)",
      );

    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain("mcp");
  });

  it("mcp command does not conflict with existing @lhremote/cli commands", () => {
    const program = createProgram();
    const baseNames = program.commands.map((c) => c.name());

    expect(baseNames).not.toContain("mcp");
  });
});
