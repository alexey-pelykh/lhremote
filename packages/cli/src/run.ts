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
 *
 * **This contract is stated twice, and this is the other half of that.**
 * `packages/mcp/src/run.ts` states it for the `lhremote-mcp` bin, whose
 * entrypoint has no commander in it, so there was nothing here for it to
 * call.  It was kept there rather than shared because the only home both
 * packages already reach is `@lhremote/core`, where no non-test source calls
 * `process.exit` or writes to `process.stderr`, and `@lhremote/mcp` must not
 * take a dependency on this package to borrow one (#945).  The two catch
 * bodies share what matters: same trim before the emptiness test, same guarded
 * write, same `process.exit` over `process.exitCode` — reached there for a
 * reason of its own, which it documents.  They stopped being *identical* in
 * #959: this one calls `errorMessage` directly, that one reaches it through a
 * lazy load that degrades to a built-in rendering when the formatter is what
 * failed.  A fix to either *reporting* body is still owed to the other, and
 * nothing mechanical enforces that: both files carry their own green suite, so
 * a one-sided edit lands green.  (`packages/lhremote/src/cli-parity.test.ts`
 * is not the instrument for it — these two are legitimately not
 * byte-identical.)
 *
 * **Where the two now deliberately differ (#959).**  That side wraps the
 * *import graph* as well as the call: its bin's only static import is a module
 * with no imports of its own, and neither the server nor the formatter is
 * loaded at module scope — each sits inside a `try` — so a throw while that
 * graph evaluates is reported rather than escaping into the ESM loader as a
 * crash dump.  This side does not do that, and the gap is real here rather
 * than absent: a static import is evaluated to completion before the importing
 * module's body runs, so a throw at module scope anywhere under `./program.js`
 * — including the `require("../package.json")` it does itself, on the same
 * shape as the read that motivated #959 — reaches Node's default handling.  It
 * is also *wider* here in a way that is this signature's doing: `runProgram`
 * takes the program as a parameter, so `createProgram()` is called by the bin,
 * outside this `try` altogether.
 *
 * Recorded rather than closed, and the reason is shape, not size — the CLI's
 * graph is in fact the smaller of the two.  This side needs a new entry
 * function, an edit to `packages/cli/src/cli.ts`, a new export subpath on this
 * package (`exports["."]` is `dist/program.js`, so `packages/lhremote` cannot
 * reach this file without statically importing the very graph it would be
 * deferring), and edits to `packages/lhremote/src/{cli,program}.ts` — four
 * files across two packages and a public export surface, where #959 moved two
 * statements in one file.
 *
 * The `lhremote` bin is why this is worth more than symmetry.
 * `packages/lhremote/src/program.ts` statically imports `@lhremote/mcp/stdio`,
 * so that bin evaluates the whole MCP graph at module scope — and
 * `npx lhremote mcp` is the invocation the README, `packages/mcp`'s README and
 * `.mcp.json` all give an MCP client, none of which mentions `lhremote-mcp`.
 * Measured with the same `require("../package.json")` fault forced: three
 * diagnosed lines out of `lhremote-mcp`, a full crash dump out of `lhremote`.
 * So #959's guarantee does not hold on the documented MCP entrypoint, and it
 * is this side that owns the reason.  Tracked as #963, which covers both bins.
 * Until it lands, do not read the two files as stating one contract about
 * startup coverage: they state one contract about *reporting*, and two
 * different ones about *reach*.
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
