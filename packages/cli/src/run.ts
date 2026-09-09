// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { Command } from "commander";

// No VALUE import, deliberately, and this file is the one place in the package
// where that is load-bearing rather than incidental.  Both bins that reach this
// module — `packages/cli/src/cli.ts` and `packages/lhremote/src/cli.ts`, which
// are byte-identical — import it FIRST and import nothing else, so anything
// imported here for its value is evaluated before {@link runProgramBin}'s catch
// exists, and a throw during that evaluation escapes into the ESM loader as a
// crash dump.  `@lhremote/core` was exactly that import until #963 moved it
// into {@link render}.  Adding a value `import` at the top of this file
// silently re-opens the hole; see {@link runProgramBin}.
//
// The `import type` above is exempt because it does not survive compilation:
// under `verbatimModuleSyntax` a type-only import is erased outright, and the
// built `dist/run.js` carries no `commander` specifier at all — measured by
// reading it after a forced build.  A plain `import { Command }` would NOT be
// erased, so keep the `type` keyword.
//
// The same applies to `packages/lhremote/src/run.ts`, which re-exports this
// module and nothing else so that `./run.js` resolves in that package too.

/**
 * Written when nothing renders a message, so a non-zero exit is never silent.
 *
 * `errorMessage` renders `""` for an `Error` whose own message is empty AND
 * that carries no renderable cause — an empty head with a live cause still
 * renders `Caused by: …` — and for a prototype-less rejection value.  It
 * renders the value UNTRIMMED for anything that is not an `Error`, so a
 * rejected `"   "` comes back as three spaces, which is blank to a reader but
 * not to `length`.  All re-measured against the built formatter at `bc5578b`.
 *
 * The claim this line used to carry — that "every other caller in this repo
 * hides the case behind a prefix of its own" — was FALSE, and it is corrected
 * rather than deleted because the conclusion it was propping up survives on a
 * different reason.  Re-measured at `bc5578b`: 114 `process.stderr.write` sites
 * across 70 files under `./handlers/` render a caught value with nothing in
 * front of it — 79 `` `${message}\n` ``, 27 `` `${error.message}\n` ``, 8
 * `` `${errorMessage(error)}\n` ``.  (Prefixed writes exist and are correctly
 * excluded from that count: `./handlers/campaign-create.ts` writes
 * `` `Failed to create campaign: ${error.message}\n` ``, and canarying the
 * probe against it returns no match.)  So an un-prefixed render is the repo's
 * norm, not this boundary's peculiarity.
 *
 * What IS specific here is position, not prefix: this is the outermost catch
 * in the bin.  A handler that renders a blank line has already returned by the
 * time control arrives here, so nothing downstream can notice — which is why
 * the emptiness test runs on what a reader would see rather than on what was
 * returned.
 *
 * {@link lastResortMessage} funnels into the same stand-in, and on the degraded
 * path this line is very slightly wider than it says: that function reads only
 * the value's own text, so an empty head whose diagnosis lives in a `cause`
 * reports as carrying no message where `errorMessage` would have printed the
 * cause.  Reaching that needs the formatter to be unavailable AND such a value,
 * and the two are close to mutually exclusive — if `@lhremote/core` failed to
 * evaluate then `./program.js` failed with it, and what arrives here is the
 * loader's own error, which carries a message.  Recorded rather than fixed
 * because the fix is a second formatter.
 */
const UNREPORTABLE = "Command failed, and the error carried no message";

/**
 * Render `error` using nothing this module could have failed to load.
 *
 * Reachable, not defensive padding — and reachable on a narrower condition than
 * "the graph threw".  `@lhremote/core` is inside the graph the catch in
 * {@link runProgramBin} now covers: `./program.js` statically imports
 * `./handlers/index.js`, and the handlers import `@lhremote/core` directly.  So
 * the formatter is unloadable when the module that failed is `@lhremote/core`
 * itself, or one in its own graph, and the re-import in {@link render} then
 * fails identically — a module that threw while evaluating keeps its evaluation
 * error and re-throws it rather than re-running.
 *
 * A throw anywhere ELSE under `./program.js` leaves core evaluated and cached,
 * and {@link render} formats normally.  That is the ordinary case rather than a
 * corner, and it is the case #963 was measured against: the module-scope
 * `require("../package.json")` in `./program.js` runs AFTER that module's own
 * static imports have completed, so core is already cached when it throws.
 *
 * It renders less than `errorMessage` does and that is the whole cost of this
 * path: no `Caused by:` chain, no elision note.  Duplicating that logic here to
 * recover them would put a second formatter in the tree, which is the thing
 * this package refuses to do for `errorMessage` itself.  The head text is what
 * names the failure; the chain is what explains it, and an unloadable module
 * has no chain worth the duplication.
 *
 * Both branches go through `String()`, and the `Error` branch needs it as much
 * as the other one: `message` is typed `string` but nothing enforces that at
 * runtime, and an `Error` carrying a non-string message would otherwise be
 * returned as-is and throw on the caller's `.trim()` — inside the catch, with
 * no handler left, which is this bug one level up.
 *
 * `String()` is inside the `try` because it is a call, not a coercion that
 * always succeeds: it throws `TypeError` on a prototype-less value and
 * propagates whatever a hostile `toString` throws.  Returning `""` there is
 * correct rather than lossy — the value genuinely rendered no text, which is
 * what {@link UNREPORTABLE} stands in for.
 */
function lastResortMessage(error: unknown): string {
  try {
    return String(error instanceof Error ? error.message : error);
  } catch {
    return "";
  }
}

/**
 * Render `error` the way the rest of the repo does, degrading to
 * {@link lastResortMessage} when the formatter is itself what failed.
 *
 * `errorMessage` is loaded here rather than at module scope for the reason the
 * header comment gives, and in the reporting path rather than beside the
 * program load so that the success path never pays for it — `./program.js`
 * pulls `@lhremote/core` in anyway, so on a normal run this import is a cache
 * hit that never happens.
 *
 * The `catch` wraps both statements, and the `import` is what makes it
 * load-bearing: a formatter that fails to load is the case
 * {@link lastResortMessage} exists for, and no totality in `errorMessage` can
 * help with it.  This is the one function in the package whose own failure has
 * nowhere to be reported, so the guard is on the call rather than on trust.
 */
async function render(error: unknown): Promise<string> {
  try {
    const { errorMessage } = await import("@lhremote/core");
    return errorMessage(error);
  } catch {
    return lastResortMessage(error);
  }
}

/**
 * Report `error` on stderr and exit 1 — the single reporting body both entries
 * below share.
 *
 * Written once rather than twice because the two entries differ in what they
 * put inside the `try`, never in what they do with what comes out of it.  A
 * change here — a new silent-value shape, a change in what `errorMessage`
 * renders — reaches {@link runProgram} and {@link runProgramBin} together, and
 * is still owed to `packages/mcp/src/run.ts`, which states the same body for a
 * bin this package must not be a dependency of (#945).
 *
 * Three decisions, all inherited from #933 and unchanged by #963:
 *
 * - **Trimmed before the emptiness test, not after.**  The `Error` path in
 *   `errorMessage` trims its own head, the non-`Error` path does not, and an
 *   all-whitespace message is exactly as silent as an empty one.
 * - **The report itself is guarded.**  A failing `process.stderr.write` is one
 *   of the paths #933 names, and letting it throw would reject out of the one
 *   function whose job is to report — the bug, re-created one level up.  If
 *   stderr is gone there is nothing left to report through, so the exit code
 *   becomes the whole message.
 * - **Exits 1 rather than setting `process.exitCode`.**  Not because a
 *   rejection skips cleanup — a `finally` runs on the way out, and most
 *   operations here close their CDP client in one.  It is that some do not: an
 *   operation that constructs and connects its client *before* entering the
 *   `try` leaves a live socket no `finally` closes, and the client's own
 *   WebSocket error listener rejects without closing either.  From inside the
 *   catch there is no way to tell which kind just failed, and on the leaking
 *   kind `process.exitCode` alone would leave the bin hanging on the handle.  A
 *   hang is the worse failure: it is indistinguishable from work still in
 *   progress and it blocks any script wrapping the bin.
 *
 * The `await` this body now contains does not widen that hang window.  On every
 * path that reaches here with the graph intact, `@lhremote/core` is already
 * cached, and a dynamic import of a cached module settles entirely in the
 * microtask queue — so no queued request is dispatched between the failure and
 * the exit.  On the path where it is NOT cached the graph failed, and there is
 * no CDP client to leak because nothing got far enough to build one.
 */
async function report(error: unknown): Promise<void> {
  const message = (await render(error)).trim();

  try {
    process.stderr.write(`${message.length > 0 ? message : UNREPORTABLE}\n`);
  } catch {
    // Nothing to report through, and nothing further to try.
  }

  process.exit(1);
}

/**
 * Parse `process.argv` against an ALREADY-BUILT program and await the action
 * handler it resolves to.
 *
 * Public API, and that is why it still exists in this shape: it is re-exported
 * by `packages/cli/src/program.ts`, and again by
 * `packages/lhremote/src/program.ts`, so its signature is part of two packages'
 * surfaces.  {@link runProgramBin} is what the bins call now; this is what a
 * caller holding a `Command` calls.
 *
 * Bin entrypoints call `parseAsync()` rather than commander's synchronous
 * `.parse()`.  That call does not await an async action, so a handler that
 * rejects surfaces as an unhandled rejection instead of a reported failure
 * (#933) — measurably so: under `--unhandled-rejections=none` the old idiom
 * exited 0 with an empty stderr, reporting success for a command that had
 * failed.  `parseAsync()` hands back the promise `.parse()` drops.
 *
 * **Its reporting now goes through {@link report}, and so through
 * {@link render}.**  Before #963 this function called a statically-imported
 * `errorMessage` directly.  It no longer can — that import is what put
 * `@lhremote/core` in front of the catch — so the formatter arrives by lazy
 * load, with the {@link lastResortMessage} degradation behind it.  For a caller
 * that already holds a built `Command` the degraded branch is close to
 * unreachable: building the program required `./program.js`, which required
 * core.  It costs nothing to keep and it is one body rather than two.
 *
 * **What this function does NOT cover, and {@link runProgramBin} does.**  The
 * program is a *parameter*, so whatever built it — the `./program.js` import
 * and the `createProgram()` call — happened before control reached here.  A
 * throw in either is outside this `try` and always was.
 *
 * **Never reached by commander's own failures.**  `--help`, `--version`, an
 * unknown command and an invalid option argument are all resolved inside
 * commander, which writes its output and calls `process.exit()` before the
 * promise settles — it throws instead only under `exitOverride()`, which no
 * program built here sets.  Routing a rejection through this path therefore
 * leaves every one of those outputs byte-for-byte unchanged.
 *
 * A handler that sets `process.exitCode` and returns normally — the shape
 * nearly every handler in `./handlers/` uses — never enters the catch at all,
 * and its exit code survives.
 */
export async function runProgram(program: Command): Promise<void> {
  try {
    await program.parseAsync();
  } catch (error: unknown) {
    await report(error);
  }
}

/**
 * Run a CLI bin end to end: load its program, build it, parse argv — every step
 * inside one `try`, so a throw at any of them is reported rather than escaping.
 *
 * This is what `packages/{cli,lhremote}/src/cli.ts` call, and the thunk is the
 * whole point of the signature.  `loadProgram` is INVOKED inside the `try`, so
 * both the dynamic `import("./program.js")` the bins pass and the
 * `createProgram()` call inside it are covered.  Passing a built `Command`
 * instead — {@link runProgram}'s signature — cannot cover either, because both
 * would have had to happen first.
 *
 * **What #963 closed.**  A static `import` is evaluated to completion before
 * the importing module's body runs, so a throw at module scope anywhere under
 * `./program.js` — the `require("../package.json")` it does itself, anything
 * under `./handlers/`, `commander`, `@lhremote/core` and its graph — happened
 * before any catch existed and produced a crash dump: the throwing source line,
 * a caret, the stack, and the ESM loader frames beneath it.  Measured on both
 * built bins with that read forced to fail, before and after: 24 lines of dump
 * before, one diagnosed line after, exit 1 either way — which is why the exit
 * code alone does not discriminate and stderr is the observable.
 *
 * **The `lhremote` bin is why this was worth more than symmetry with
 * `packages/mcp`.**  `packages/lhremote/src/program.ts` used to statically
 * import `@lhremote/mcp/stdio`, so that bin evaluated the whole MCP graph at
 * its own module scope — for `lhremote --version` as much as for
 * `lhremote mcp`.  And `npx lhremote mcp` is the invocation the README,
 * `packages/mcp`'s README and `.mcp.json` all give an MCP client; none of them
 * mentions `lhremote-mcp`, the bin where #959 had already fixed this.  That
 * import is now inside the `mcp` action, which runs inside `parseAsync()`,
 * which is inside this `try`.
 *
 * **The formatter is deferred for the same reason and not merely for
 * symmetry.**  Keeping `errorMessage` a static import would leave
 * `@lhremote/core`'s whole graph evaluating ahead of the catch, and "the graph
 * is covered" would have been false while looking true.
 *
 * **`void`, not a rejection this function lets escape.**  The bins call this
 * without awaiting it, so it must never reject: every failure inside is routed
 * to {@link report}, which exits.  A `void` over a function that let its own
 * rejection escape would exit 0 with an empty stderr under
 * `--unhandled-rejections=none` — the #933 defect, one level up.
 *
 * **This contract is stated twice, and after #963 the two statements are much
 * closer than they were.**  `packages/mcp/src/run.ts` states it for the
 * `lhremote-mcp` bin.  It was kept there rather than shared because the only
 * home both packages already reach is `@lhremote/core`, where no non-test
 * source calls `process.exit` or writes to `process.stderr`, and
 * `@lhremote/mcp` must not take a dependency on this package to borrow one
 * (#945).  Both of those reasons are still true, so the duplication stays.
 *
 * What the two now SHARE is everything #959 had left one-sided: no value import
 * at module scope, the entry's whole graph loaded inside its own `try`, the
 * two-function {@link render} / {@link lastResortMessage} degradation, and the
 * reporting body itself.  A fix to any of that is owed to the other file, and
 * nothing mechanical enforces it: both carry their own green suite, so a
 * one-sided edit lands green.  (`packages/lhremote/src/cli-parity.test.ts` is
 * not the instrument for it — these two are legitimately not byte-identical.)
 *
 * Where they still genuinely differ, and these are not gaps:
 *
 * - **Two entries here, one there.**  {@link runProgram} is public API this
 *   package cannot drop, and it covers strictly less by construction.  The MCP
 *   bin has no commander in it and nothing equivalent to export.
 * - **Different reasons for `process.exit` over `process.exitCode`** — a CDP
 *   socket no `finally` closes here, a ref'd `data` listener on `process.stdin`
 *   there.  Same decision, different failure being avoided.
 * - **Different stand-in text**, because the two bins fail at different things:
 *   a command that failed here, a server that never started there.
 */
export async function runProgramBin(
  loadProgram: () => Promise<Command>,
): Promise<void> {
  try {
    const program = await loadProgram();
    await program.parseAsync();
  } catch (error: unknown) {
    await report(error);
  }
}
