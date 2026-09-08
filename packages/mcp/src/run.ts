// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { errorMessage } from "@lhremote/core";

import { runStdioServer } from "./stdio.js";

/**
 * Written when `errorMessage` renders nothing to say, so a non-zero exit is
 * never silent.  It renders `""` for an `Error` carrying an empty message and
 * for a prototype-less rejection value, and it renders the value UNTRIMMED for
 * anything that is not an `Error` — so a rejected `"   "` comes back as three
 * spaces, which is blank to a reader but not to `length`.  All measured.  The
 * two `process.stderr.write` calls in `runStdioServer` hide that case behind a
 * prefix of their own; this one has none, so it tests what a reader would see
 * rather than what was returned.
 */
const UNREPORTABLE =
  "MCP server failed to start, and the error carried no message";

/**
 * Start the stdio MCP server as a bin, reporting a startup failure rather than
 * letting it escape.
 *
 * `packages/mcp/src/index.ts` used to `await runStdioServer()` at module top
 * level with no `catch`, so a rejection escaped into Node's own handling
 * instead of a deliberate reporting path (#945).  What that produced, measured
 * on the built bin with each failure below forced in turn: exit 1 with a crash
 * dump — the throwing source line, a caret, the stack, and the ESM loader
 * frames beneath it — where one diagnosed line was wanted.
 *
 * That is the whole of it, and it is worth being exact about the half that is
 * NOT true here, because the sibling fix's reasoning does not transfer.  #933
 * measured `packages/cli`'s dropped `.parse()` promise exiting 0 with an empty
 * stderr under `--unhandled-rejections=none` — a silent success for a command
 * that had failed.  A top-level `await` does not behave that way: the ESM
 * loader is itself awaiting the module job, so its rejection is an entry-point
 * failure rather than an unhandled one, and the flag does not govern it.
 * Measured on the built bin, all three failures below, both modes: exit 1 and
 * a byte-identical dump.  The flag was canaried in the same run against a
 * genuinely dropped rejection, which did exit 0 with an empty stderr.
 *
 * What can actually reject out of `runStdioServer`, all of it startup:
 * `createServer()` throwing, `new StdioServerTransport()` throwing, and the
 * `process.stderr.write` that announces the server — which sits after a
 * successful `connect()` and outside its `try` — failing with EPIPE.  A
 * `connect()` failure is already caught and reported inside that function; it
 * never reaches here.
 *
 * The decision, in four parts:
 *
 * - **Reported on stderr** through `errorMessage`, the stream and formatter
 *   `runStdioServer` already uses for both of its own failure paths.
 * - **The report itself is guarded**, on both axes.  A failing
 *   `process.stderr.write` is one of the three paths above, and letting it
 *   throw would reject out of the one function whose job is to report — the
 *   bug, re-created one level up.  If stderr is gone there is nothing left to
 *   report through, so the exit code becomes the whole message.  And the
 *   emptiness test runs on the TRIMMED message, per {@link UNREPORTABLE}.
 * - **Exits 1 rather than setting `process.exitCode`.**  The reason is this
 *   package's, not the CLI's: `server.connect(transport)` calls the
 *   transport's `start()`, which attaches a `data` listener to `process.stdin`
 *   — a live, ref'd handle, and the very one that keeps the server alive after
 *   startup returns.  The EPIPE path above rejects with that listener already
 *   attached, so `process.exitCode` alone would leave the bin hanging on it
 *   rather than exiting.  Measured directly: with a `data` listener attached
 *   and stdin an open pipe, a process that sets `process.exitCode` and returns
 *   does not exit; without the listener it exits immediately.  A hang is the
 *   worse failure — indistinguishable from a server running normally, which is
 *   exactly what this bin looks like when it is working.  This is also
 *   `runStdioServer`'s own idiom, which calls `process.exit` on both of its
 *   failure paths.
 * - **Kept in this package rather than shared.**  The only home both packages
 *   already reach is `@lhremote/core`, and no non-test source under
 *   `packages/core/src/` touches `process` at all — not `process.exit`, not
 *   `process.stderr`.  Putting a process-terminating function on a library's
 *   public API to save a handful of lines trades that property away for a
 *   bounded duplication, and `@lhremote/mcp` must not depend on
 *   `@lhremote/cli` to borrow one either.
 *
 * That last part has a cost, and this is the half of it that has to be paid
 * here: **the same contract is now stated twice.**  `packages/cli/src/run.ts`
 * is the other statement of it — same stderr-and-`errorMessage` reporting,
 * same trim-before-the-emptiness-test, same guarded write, same `process.exit`
 * over `process.exitCode`, reached there for a different reason it documents
 * itself.  The two differ only in what they wrap and in that reason.  A fix to
 * either — a new silent-value shape, a change in what `errorMessage` renders —
 * is owed to the other.
 */
export async function runStdioBin(): Promise<void> {
  try {
    await runStdioServer();
  } catch (error: unknown) {
    // Trimmed before the emptiness test, not after: the `Error` path in
    // `errorMessage` trims its own head, the non-`Error` path does not, and an
    // all-whitespace message is exactly as silent as an empty one.
    const message = errorMessage(error).trim();

    try {
      process.stderr.write(`${message.length > 0 ? message : UNREPORTABLE}\n`);
    } catch {
      // Nothing to report through, and nothing further to try.
    }

    process.exit(1);
  }
}
