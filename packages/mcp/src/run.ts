// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// No static import, deliberately, and this file is the one place in the package
// where that is load-bearing rather than incidental.  Everything this module
// needs — the server it starts and the formatter it reports with — is loaded
// inside `runStdioBin`, because a static import here is evaluated before the
// catch below exists and a throw during that evaluation escapes into the ESM
// loader (#959).  Adding an `import` at the top of this file silently re-opens
// that hole; see {@link runStdioBin}.  The same applies to
// `packages/mcp/src/index.ts`, which is why it imports this module and nothing
// else — and which no test can guard, since importing it starts the server.

/**
 * Written when nothing renders a message, so a non-zero exit is never silent.
 *
 * `errorMessage` renders `""` for an `Error` whose own message is empty AND
 * that carries no renderable cause — an empty head with a live cause still
 * renders `Caused by: …`, measured — and for a prototype-less rejection value.
 * It renders the value UNTRIMMED for anything that is not an `Error`, so a
 * rejected `"   "` comes back as three spaces, which is blank to a reader but
 * not to `length`.  All measured.  Every other write in `runStdioServer` that
 * renders one of these hides the case behind a prefix of its own; this one has
 * none, so it tests what a reader would see rather than what was returned.
 *
 * {@link lastResortMessage} funnels into the same stand-in, and on the
 * degraded path this line is very slightly wider than it says: that function
 * reads only the value's own text, so an empty head whose diagnosis lives in a
 * `cause` reports as carrying no message when `errorMessage` would have
 * printed the cause.  Reaching that needs the formatter to be unavailable AND
 * such a value, and the two are close to mutually exclusive — if
 * `@lhremote/core` failed to evaluate then `./stdio.js` failed with it, and
 * what arrives here is the loader's own error, which carries a message.  It is
 * recorded rather than fixed because the fix is a second formatter.
 */
const UNREPORTABLE =
  "MCP server failed to start, and the error carried no message";

/**
 * Render `error` using nothing this module could have failed to load.
 *
 * Reachable, not defensive padding — and reachable on a narrower condition
 * than "the graph threw".  `@lhremote/core` is inside the graph the catch in
 * {@link runStdioBin} now covers — `./stdio.js` imports it directly, and so
 * does all but a handful of the modules under `./tools/` — so the formatter is
 * unloadable when the module that failed is `@lhremote/core` itself, or one in
 * its own graph, and the re-import in {@link render} then fails identically: a
 * module that threw while evaluating keeps its evaluation error and re-throws
 * it rather than re-running (and the sub-cases that are not evaluation errors —
 * a resolution failure, a parse error — fail again on the same inputs).
 *
 * A throw anywhere ELSE under `./stdio.js` leaves core evaluated and cached,
 * and {@link render} formats normally.  That is the ordinary case rather than a
 * corner: `./stdio.js` imports core ahead of `./server.js`, so the very fault
 * #959 was measured against — the module-scope `require("../package.json")` in
 * `./server.js` — is on the undegraded side.  Both halves measured on the built
 * bin with the forced throw carrying a `cause`: the `./server.js` fault
 * reported the `Caused by:` line only `errorMessage` writes, the
 * `@lhremote/core` fault reported the head alone.
 *
 * It renders less than `errorMessage` does and that is the whole cost of this
 * path: no `Caused by:` chain, no elision note.  Duplicating that logic here
 * to recover them would put a second formatter in the tree, which is the thing
 * this package refuses to do for `errorMessage` itself.  The head text is what
 * names the failure; the chain is what explains it, and an unloadable module
 * has no chain worth the duplication.
 *
 * Both branches go through `String()`, and the `Error` branch needs it as much
 * as the other one: `message` is typed `string` but nothing enforces that at
 * runtime, and an `Error` carrying a non-string message would otherwise be
 * returned as-is and throw on the caller's `.trim()` — inside the catch, with
 * no handler left, which is this bug one level up.  `errorMessage` itself was
 * measured throwing `TypeError` on that same input once, at its own `.trim()`;
 * #965 closed that path by coercing the message rather than returning it
 * unchanged, so it is history and not a live reason for {@link render}'s
 * catch.  What warrants that catch is the dynamic `import` it wraps, which can
 * fail to load.
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
 * header comment gives, and in the *catch* rather than beside the server load
 * so that the success path never pays for it — `./stdio.js` pulls
 * `@lhremote/core` in anyway, so on a normal start this import is a cache hit
 * that never happens.
 *
 * The `catch` wraps both statements, and the `import` is what makes it
 * load-bearing: a formatter that fails to load is the case
 * {@link lastResortMessage} exists for, and no totality in `errorMessage` can
 * help with it.  The non-string-message case above is history rather than a
 * live instance of the formatter throwing — #965 closed it.  This is the one
 * function in the package whose own failure has nowhere to be reported, so the
 * guard is on the call rather than on trust.
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
 * That fix wrapped the *call*, which left the *import graph* uncovered (#959):
 * a static `import` is evaluated to completion before the importing module's
 * body runs, so a throw at module scope anywhere under `./stdio.js` — the
 * `require("../package.json")` in `./server.js`, anything under `./tools/`,
 * the MCP SDK, `zod`, `@lhremote/core` — happened before this function was
 * ever entered and produced exactly the crash dump #945 was filed against.
 * Measured on the built bin, that read forced to fail: byte-for-byte the same
 * dump the pre-#945 entrypoint gave.  Neither import below is at module scope
 * therefore; each is inside a `try` — the server's in this function's, the
 * formatter's in {@link render}'s, reached from this function's catch.
 *
 * The formatter is deferred for the same reason and not merely for symmetry.
 * Keeping `errorMessage` a static import would leave `@lhremote/core`'s whole
 * graph — `execa`, `ps-list`, `pid-port`, `get-port`, `yaml` and their
 * dependencies — evaluating ahead of the catch, which measured as more than
 * half the modules the bin loads at all: a reading taken when this landed, not
 * a live invariant, and the ratio is not the point.  The point is that "the
 * graph is covered" would have been false while looking true.
 *
 * It is worth being exact about the half of #945's reasoning that is NOT true
 * here, because the sibling fix's does not transfer.  #933 measured
 * `packages/cli`'s dropped `.parse()` promise exiting 0 with an empty stderr
 * under `--unhandled-rejections=none` — a silent success for a command that
 * had failed.  A top-level `await` does not behave that way: the ESM loader is
 * itself awaiting the module job, so its rejection is an entry-point failure
 * rather than an unhandled one, and the flag does not govern it.  Measured on
 * the built bin, both modes: exit 1 and a byte-identical dump.  The flag was
 * canaried in the same run against a genuinely dropped rejection, which did
 * exit 0 with an empty stderr.
 *
 * What can reject inside the `try`, in the order it becomes reachable:
 *
 * 1. **Evaluation of the `./stdio.js` import graph**, per the paragraph above.
 *    This is the entry #959 added; it is also the only one that can leave the
 *    formatter unloadable, which is what {@link render} exists for.
 * 2. `createServer()` throwing, or `new StdioServerTransport()` throwing.
 * 3. The `process.stderr.write` that announces the server — it sits after a
 *    successful `connect()` and outside its `try` — failing with EPIPE.
 * 4. The write inside `runStdioServer`'s own connect-failure catch, which is
 *    unguarded: an EPIPE there escapes before the `process.exit(1)` beneath it
 *    runs, and arrives here as a fourth thing to absorb.  (Absorbed correctly,
 *    but the connect diagnosis is lost with the stderr that would have carried
 *    it, which is the degraded case the *third* bullet below describes — the
 *    stderr-is-gone one, not the formatter one.)
 *
 * A `connect()` failure itself is caught and reported inside that function, so
 * it does not reach here — unless that report is what fails, which is (4).
 * Items (3) and (4) are exclusive branches of the same `connect()` settlement,
 * so the ordering above is the happy path's, not a total order.
 *
 * The decision, in five parts:
 *
 * - **Neither import is at module scope; each is inside a `try`.**  Nothing
 *   this module needs may be reachable from its own module scope, or the graph
 *   is uncovered again.  The header comment says so where an author adding an
 *   `import` will see it.
 * - **Reported on stderr** through `errorMessage`, the stream and formatter
 *   `runStdioServer` already uses for both of its own failure paths — degraded
 *   to {@link lastResortMessage} on the sub-case of (1) that cannot load it.
 * - **The report itself is guarded**, on both axes.  A failing
 *   `process.stderr.write` is one of the paths above, and letting it throw
 *   would reject out of the one function whose job is to report — the bug,
 *   re-created one level up.  If stderr is gone there is nothing left to
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
 *   failure paths.  The `await` this catch now contains does not reopen that
 *   listener's window: a dynamic import of an already-cached module settles
 *   entirely in the microtask queue — measured, resolving ahead of a
 *   `setImmediate` queued before it, with the same probe canaried against a
 *   real macrotask — and microtasks drain before the loop reaches the poll
 *   phase, so no queued request is dispatched between the failure and the exit.
 * - **Kept in this package rather than shared.**  The only home both packages
 *   already reach is `@lhremote/core`, and no non-test source under
 *   `packages/core/src/` calls `process.exit` or writes to `process.stderr` —
 *   measured, and the narrow claim is the one that matters: core does touch
 *   `process` elsewhere (`process.env`, `process.platform`, and
 *   `process.kill` against a foreign pid), so the property is not that it
 *   never touches it but that it never terminates its caller and never owns
 *   its caller's stderr.  Putting a process-terminating function on a library's
 *   public API to save a handful of lines trades that property away for a
 *   bounded duplication, and `@lhremote/mcp` must not depend on
 *   `@lhremote/cli` to borrow one either.
 *
 * That last part has a cost, and this is the half of it that has to be paid
 * here: **the same contract is stated twice.**  `packages/cli/src/run.ts` is
 * the other statement of it — same stderr reporting, same
 * trim-before-the-emptiness-test, same guarded write, same `process.exit` over
 * `process.exitCode`, reached there for a different reason it documents itself.
 * A fix to either *reporting* body — a new silent-value shape, a change in what
 * `errorMessage` renders — is owed to the other, and nothing mechanical
 * enforces that: both files carry their own green suite, so a one-sided edit
 * lands green.  (`packages/lhremote/src/cli-parity.test.ts` is not the
 * instrument for it — these two are legitimately not byte-identical.)
 *
 * **The divergence #959 recorded here is CLOSED, and #963 closed it.**  What
 * this comment used to say — that the graph coverage above did not exist on the
 * CLI side, that `runProgram` took the program as a *parameter* so the bins
 * called `createProgram()` outside the `try`, and that
 * `packages/lhremote/src/program.ts` statically imported `@lhremote/mcp/stdio`
 * so the `lhremote` bin evaluated THIS package's graph at its own module scope
 * — was true when written and is not true now.  Do not read it out of the
 * history as a live gap.
 *
 * #963 did there what #959 did here, plus the two things that side needed and
 * this one did not: a new entry function taking a THUNK, `runProgramBin`, so
 * that the `./program.js` import and the `createProgram()` call are both inside
 * its `try`; and a new `@lhremote/cli` export subpath, `./run`, because that
 * package's `exports["."]` is `dist/program.js` and `packages/lhremote` could
 * not otherwise reach `run.js` without statically importing the very graph it
 * was deferring.  The `mcp` subcommand's action now loads
 * `@lhremote/mcp/stdio` dynamically, inside `parseAsync()`, inside that `try`.
 * Re-measured on the built bins with the same `require("../package.json")`
 * fault forced: `npx lhremote mcp` now writes the SAME diagnosed stderr this
 * bin does, byte-for-byte, where it wrote a 24-line crash dump before; and
 * `lhremote --version` no longer touches this package's graph at all, so it
 * prints the version and exits 0 where it used to dump and exit 1.
 *
 * So the two files now share what #959 had left one-sided: no value import at
 * module scope, the entry's whole graph loaded inside its own `try`, and the
 * {@link render} / {@link lastResortMessage} degradation.  A fix to any of THAT
 * is owed both ways too, on the same honour system.
 *
 * Where the two still genuinely differ, and none of these is a gap:
 *
 * - **Two entries there, one here.**  `runProgram` is public API that package
 *   cannot drop — `packages/cli/src/program.ts` re-exports it and
 *   `packages/lhremote/src/program.ts` re-exports that — and it still takes a
 *   built `Command`, so it still covers strictly less than `runProgramBin`.
 *   This bin has no commander in it and nothing equivalent to export.
 * - **Different reasons for `process.exit` over `process.exitCode`** — a ref'd
 *   `data` listener on `process.stdin` here, a CDP socket no `finally` closes
 *   there.  Same decision, different failure being avoided, and each side
 *   documents its own.
 * - **Different {@link UNREPORTABLE} text**, because the two bins fail at
 *   different things: a server that never started here, a command that failed
 *   there.
 */
export async function runStdioBin(): Promise<void> {
  try {
    const { runStdioServer } = await import("./stdio.js");
    await runStdioServer();
  } catch (error: unknown) {
    // Trimmed before the emptiness test, not after: the `Error` path in
    // `errorMessage` trims its own head, the non-`Error` path does not, and an
    // all-whitespace message is exactly as silent as an empty one.
    const message = (await render(error)).trim();

    try {
      process.stderr.write(`${message.length > 0 ? message : UNREPORTABLE}\n`);
    } catch {
      // Nothing to report through, and nothing further to try.
    }

    process.exit(1);
  }
}
