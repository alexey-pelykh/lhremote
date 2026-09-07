// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { createProgram as createBaseProgram } from "@lhremote/cli";
import { runStdioServer } from "@lhremote/mcp/stdio";

// Re-exported so this package's bin entrypoint delegates exactly as
// `@lhremote/cli`'s does — same import, same call, no room to diverge (#933).
export { runProgram } from "@lhremote/cli";

/**
 * Compose the meta-package CLI: the whole `@lhremote/cli` program plus the
 * `mcp` subcommand that starts the stdio MCP server.
 *
 * Lives here rather than in `cli.ts` so it can be imported and exercised.
 * `cli.ts` is a bin entrypoint — it parses argv the moment it is loaded, so a
 * test that imports it runs the CLI instead of testing it.
 */
export function createProgram(): ReturnType<typeof createBaseProgram> {
  const program = createBaseProgram();

  program
    .command("mcp")
    .description("Start MCP server on stdio (for Claude Desktop, Cursor, etc.)")
    .action(async () => {
      await runStdioServer();
    });

  return program;
}
