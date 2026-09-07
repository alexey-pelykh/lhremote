// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { Command } from "commander";

import { errorMessage } from "@lhremote/core";

/**
 * Written when `errorMessage` renders nothing to say, so a non-zero exit is
 * never silent.  It renders `""` for an `Error` carrying an empty message and
 * for a prototype-less rejection value, and it renders the value UNTRIMMED for
 * anything that is not an `Error` — so a rejected `"   "` comes back as three
 * spaces, which is blank to a reader but not to `length`.  All measured.  Every
 * other caller in this repo hides the case behind a prefix of its own; this one
 * has none, so it tests what a reader would see rather than what was returned.
 */
const UNREPORTABLE = "Command failed, and the error carried no message";

/**
 * Parse `process.argv` and await the action handler it resolves to.
 *
 * Bin entrypoints call this rather than commander's synchronous `.parse()`.
 * That call does not await an async action, so a handler that rejects
 * surfaces as an unhandled rejection instead of a reported failure (#933) —
 * measurably so: under `--unhandled-rejections=none` the old idiom exited 0
 * with an empty stderr, reporting success for a command that had failed.
 * `parseAsync()` hands back the promise `.parse()` drops, and this function
 * is the single place that decides what a rejection means.
 *
 * The decision, in four parts:
 *
 * - **Reported on stderr** through `errorMessage`, the stream and formatter
 *   every command handler and `runStdioServer` already use.
 * - **The report itself is guarded.** A failing `process.stderr.write` is one
 *   of the paths #933 names, and letting it throw would reject out of the one
 *   function whose job is to report — the bug, re-created one level up. If
 *   stderr is gone there is nothing left to report through, so the exit code
 *   becomes the whole message.
 * - **Exits 1 rather than setting `process.exitCode`.** Not because a
 *   rejection skips cleanup — a `finally` runs on the way out, and most
 *   operations here close their CDP client in one. It is that some do not:
 *   an operation that constructs and connects its client *before* entering
 *   the `try` leaves a live socket no `finally` closes, and the client's own
 *   WebSocket error listener rejects without closing either. From inside this
 *   catch there is no way to tell which kind just failed, and on the leaking
 *   kind `process.exitCode` alone would leave the bin hanging on the handle.
 *   A hang is the worse failure: it is indistinguishable from work still in
 *   progress and it blocks any script wrapping the bin. This is also
 *   `runStdioServer`'s own fatal-startup idiom.
 * - **Never reached by commander's own failures.** `--help`, `--version`, an
 *   unknown command and an invalid option argument are all resolved inside
 *   commander, which writes its output and calls `process.exit()` before the
 *   promise settles — it throws instead only under `exitOverride()`, which no
 *   program built here sets. Routing a rejection through this path therefore
 *   leaves every one of those outputs byte-for-byte unchanged.
 *
 * A handler that sets `process.exitCode` and returns normally — the shape
 * nearly every handler in `./handlers/` uses — never enters the catch at all,
 * and its exit code survives.
 */
export async function runProgram(program: Command): Promise<void> {
  try {
    await program.parseAsync();
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
