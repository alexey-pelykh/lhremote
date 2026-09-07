// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { Command } from "commander";

import { errorMessage } from "@lhremote/core";

/**
 * Parse `process.argv` and await the action handler it resolves to.
 *
 * Bin entrypoints call this rather than commander's synchronous `.parse()`.
 * That call does not await an async action, so a handler that rejects
 * surfaces as an unhandled rejection instead of a reported failure (#933).
 * `parseAsync()` hands back the promise `.parse()` drops, and this function
 * is the single place that decides what a rejection means.
 *
 * The decision, in three parts:
 *
 * - **Reported on stderr**, through `errorMessage`, which is the stream and
 *   the formatter every command handler and `runStdioServer` already use.
 * - **Exits 1 immediately** rather than setting `process.exitCode`. An action
 *   that rejected skipped its own cleanup by definition, so a live handle (a
 *   CDP socket, an MCP transport) is plausible, and `process.exitCode` alone
 *   would leave the bin hanging on it. A hang is the worse failure: it is
 *   indistinguishable from work still in progress and it blocks any script
 *   wrapping the bin, where a truncated tail of a one-line message would not.
 *   Measured: a message this size survives the exit — a pipe absorbs it well
 *   inside its buffer. This matches `runStdioServer`'s own fatal-startup path.
 * - **Never reached by commander's own failures.** `--help`, `--version`, an
 *   unknown command and an invalid option argument are all resolved inside
 *   commander, which writes its output and calls `process.exit()` before the
 *   promise settles. Routing a rejection through here therefore leaves every
 *   one of those outputs byte-for-byte unchanged.
 */
export async function runProgram(program: Command): Promise<void> {
  try {
    await program.parseAsync();
  } catch (error: unknown) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exit(1);
  }
}
