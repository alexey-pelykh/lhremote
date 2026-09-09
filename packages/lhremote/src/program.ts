// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { createProgram as createBaseProgram } from "@lhremote/cli";

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
      // Loaded HERE rather than at module scope, and that placement is #963's
      // fix for the documented MCP entrypoint.  A static
      // `import { runStdioServer } from "@lhremote/mcp/stdio"` — which is what
      // this file carried until #963 — evaluates the whole MCP graph when THIS
      // module is imported, so `lhremote --version` paid for it too, and a
      // throw at module scope anywhere under it (the
      // `require("../package.json")` in `@lhremote/mcp`'s `server.js`, the MCP
      // SDK, `zod`) escaped into the ESM loader as a crash dump.  #959 had
      // already closed that for the `lhremote-mcp` bin; this is the bin the
      // README, `packages/mcp`'s README and `.mcp.json` actually name to an MCP
      // client, none of which mentions `lhremote-mcp`.
      //
      // This action runs inside `parseAsync()`, which runs inside
      // `runProgramBin`'s `try` (`packages/cli/src/run.ts`), so the import's
      // failure is now reported as whatever `errorMessage` renders and exits 1
      // — three lines for the forced `require("../package.json")` fault, whose
      // `MODULE_NOT_FOUND` message carries its own require stack, against the
      // 24-line dump it produced before.  Moving this
      // specifier back to module scope re-opens exactly that, and nothing else
      // in the repo would notice: `./program.test.ts` pins that it stays here.
      const { runStdioServer } = await import("@lhremote/mcp/stdio");
      await runStdioServer();
    });

  return program;
}
