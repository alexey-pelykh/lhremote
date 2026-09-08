// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// No static import, deliberately, and this file is the one place in the package
// where that is load-bearing rather than incidental.  Everything this module
// needs — the server it starts and the formatter it reports with — is loaded
// inside `runStdioBin`, because a static import here is evaluated before the
// catch below exists and a throw during that evaluation escapes into the ESM
// loader (#959).  Adding an `import` at the top of this file silently re-opens
// that hole; see {@link runStdioBin}.

/**
 * Written when nothing renders a message, so a non-zero exit is never silent.
 *
 * `errorMessage` renders `""` for an `Error` carrying an empty message and for
 * a prototype-less rejection value, and it renders the value UNTRIMMED for
 * anything that is not an `Error` — so a rejected `"   "` comes back as three
 * spaces, which is blank to a reader but not to `length`.  All measured.  Every
 * other write in `runStdioServer` that renders one of these hides the case
 * behind a prefix of its own; this one has none, so it tests what a reader
 * would see rather than what was returned.
 *
 * {@link lastResortMessage} funnels into the same stand-in and does not widen
 * what it claims: it returns `""` only when the value's own text is empty or
 * when rendering it threw, both of which *are* "carried no message".  A
 * formatter that could not be loaded is not reported as one that rendered
 * nothing, because on that path there is still the error's own text to print.
 */
const UNREPORTABLE =
  "MCP server failed to start, and the error carried no message";

/**
 * Render `error` using nothing this module could have failed to load.
 *
 * Reachable, not defensive padding.  `@lhremote/core` is inside the graph the
 * catch in {@link runStdioBin} now covers — `./stdio.js` imports it, and so
 * does everything under `./tools/` — so a throw while that graph evaluates is
 * caught with the formatter unavailable, and the re-import in {@link render}
 * fails identically because ESM caches a module's instantiation error and
 * re-throws it rather than re-running the module.
 *
 * It renders less than `errorMessage` does and that is the whole cost of this
 * path: no `Caused by:` chain, no elision note.  Duplicating that logic here
 * to recover them would put a second formatter in the tree, which is the thing
 * this package refuses to do for `errorMessage` itself.  The head text is what
 * names the failure; the chain is what explains it, and an unloadable module
 * has no chain worth the duplication.
 *
 * `String()` is inside the `try` because it is a call, not a coercion that
 * always succeeds: it throws `TypeError` on a prototype-less value and
 * propagates whatever a hostile `toString` throws.  Returning `""` there is
 * correct rather than lossy — the value genuinely rendered no text, which is
 * exactly what {@link UNREPORTABLE} stands in for.
 */
function lastResortMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "";
  }
}

/**
 * Render `error` the way the rest of the repo does, degrading to
 * {@link lastResortMessage} when the formatter is itself what failed.
 *
 * `errorMessage` is loaded here rather than at module scope for the reason the
 * header comment gives, and *inside the catch* rather than beside the server
 * load so that the success path never pays for it — `./stdio.js` pulls
 * `@lhremote/core` in anyway, so on a normal start this import is a cache hit
 * that never happens.
 *
 * The `catch` covers the formatter throwing as well as failing to load.  It is
 * written not to, but this is the one function in the package whose own failure
 * has nowhere to be reported, so the guard is on the call rather than on trust.
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
 * dump the old entrypoint gave.  Both imports below are therefore dynamic, and
 * both are inside the `try`.
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
 *    it, which is the degraded case the second bullet below describes.)
 *
 * A `connect()` failure itself is caught and reported inside that function, so
 * it does not reach here — unless that report is what fails, which is (4).
 *
 * The decision, in five parts:
 *
 * - **Both imports are dynamic and both are inside the `try`.**  Nothing this
 *   module needs may be reachable from its own module scope, or the graph is
 *   uncovered again.  The header comment says so where an author adding an
 *   `import` will see it.
 * - **Reported on stderr** through `errorMessage`, the stream and formatter
 *   `runStdioServer` already uses for both of its own failure paths — degraded
 *   to {@link lastResortMessage} on the one path that cannot load it.
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
 *   failure paths.
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
 * here: **the same contract is stated twice, and as of #959 the two statements
 * deliberately differ.**  `packages/cli/src/run.ts` is the other statement of
 * it — same stderr-and-`errorMessage` reporting, same trim-before-the-
 * emptiness-test, same guarded write, same `process.exit` over
 * `process.exitCode`, reached there for a different reason it documents
 * itself.  A fix to either *reporting* body — a new silent-value shape, a
 * change in what `errorMessage` renders — is still owed to the other.
 *
 * What is **not** owed, and is now the recorded divergence: the graph coverage
 * above does not exist on that side, and closing it there is a strictly larger
 * change than this one rather than a transcription of it.  `runProgram` takes
 * the program as a *parameter*, so `packages/cli/src/cli.ts` calls
 * `createProgram()` — which carries the same module-scope
 * `require("../package.json")` `./server.js` does — outside the `try`
 * altogether; covering it needs a new entry function, an edit to that bin, a
 * NEW `@lhremote/cli` export subpath (its `exports["."]` is `dist/program.js`,
 * so `packages/lhremote` cannot reach `run.js` today without statically
 * importing the very graph it would be deferring), and edits to
 * `packages/lhremote/src/{cli,program}.ts`.  Four files across two packages
 * and a public export surface, on a graph measured at roughly twice this
 * one's.  Tracked separately rather than done in passing; nothing mechanical
 * enforces the pairing either way, since both files carry their own green
 * suite and a one-sided edit lands green.
 * (`packages/lhremote/src/cli-parity.test.ts` is not the instrument for it —
 * these two are legitimately not byte-identical.)
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
