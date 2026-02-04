#!/usr/bin/env node

import { createProgram } from "@lhremote/cli";
import { runStdioServer } from "@lhremote/mcp/stdio";

const program = createProgram();

program
  .command("mcp")
  .description("Start MCP server on stdio (for Claude Desktop, Cursor, etc.)")
  .action(async () => {
    await runStdioServer();
  });

program.parse();
