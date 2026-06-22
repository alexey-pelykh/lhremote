#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { createRequire } from "node:module";

import { createProgram } from "@insoftex/lhremote-cli";
import { runStdioServer } from "@insoftex/lhremote-mcp/stdio";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = createProgram({ version });

program
  .command("mcp")
  .description("Start MCP server on stdio (for Claude Desktop, Cursor, etc.)")
  .action(async () => {
    await runStdioServer();
  });

program.parse();
