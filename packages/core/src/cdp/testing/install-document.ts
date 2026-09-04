// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { delay } from "../../utils/delay.js";
import { jsString } from "../../utils/js-string.js";
import type { CDPClient } from "../client.js";
import { CDPTimeoutError } from "../errors.js";

/**
 * An empty document in standards mode.
 *
 * Two Tier-2 suites reset the page to this between tests.  The doctype is
 * load-bearing rather than decorative: without it the document installs in
 * quirks mode (`BackCompat`), where layout — and therefore any `offsetHeight`
 * read — is answered under different rules.
 *
 * Installing it also *creates* `document.body`, which is why the reset exists
 * at all: draining `document.body` from JS dereferenced it before the
 * freshly-launched target had one, a windows-only null crash (#866).
 */
export const EMPTY_DOCUMENT_HTML =
  "<!doctype html><html><head></head><body></body></html>";

/** `name` of the transient marker {@link installDocument} appends and removes. */
const SENTINEL_NAME = "lhremote-install-sentinel";

/**
 * Distinguishes one install from the next.
 *
 * A monotonic counter rather than a constant, because the gate below has to
 * reject the document a *previous* install left behind as firmly as it rejects
 * a blank one.  With a constant marker, install N+1 would be satisfied by
 * install N's leftovers on a run where the removal never landed.
 */
let installSequence = 0;

/**
 * How long to keep re-checking before declaring the install unobservable.
 *
 * Bounded by the *runner's* budget rather than by the browser's.  Vitest's
 * default per-test timeout is 5 000 ms and two of the four consumers install
 * from `it` blocks that never override it, so a deadline above that is not a
 * longer wait — it is an unreachable one: vitest aborts first, and the
 * operator gets `Test timed out in 5000ms` instead of the message below naming
 * the sentinel that never matched.  A gate whose diagnostic cannot be printed
 * is the failure this helper exists to replace, one level up.
 *
 * Three seconds leaves headroom for the install itself (~600 ms for the 352 KB
 * captured fixture) and still dwarfs the happy path, which resolves on the
 * first attempt.  A caller with a larger budget can pass a longer `timeout`;
 * the default is what has to fit the smallest one.
 */
export const DEFAULT_GATE_TIMEOUT_MS = 3_000;

/** Pause between gate attempts.  Small enough to be invisible in the happy path. */
export const DEFAULT_POLL_INTERVAL_MS = 20;

/**
 * Install `html` as the live document, and do not return until that document
 * is observable through the same channel the caller's assertions will use.
 *
 * ## The symptom this closes, and what is NOT claimed about its cause
 *
 * Every Tier-2 fixture site did the same two steps: `Page.setDocumentContent`
 * to install markup, then `client.evaluate("document.querySelectorAll(…).length")`
 * to count.  On the windows runner, roughly once per full suite and on a
 * different canary each time, the count came back `0` for *every* selector on
 * a page that carried them — clean, and wrong, because
 * `querySelectorAll(…).length` answers `0` rather than throwing when the
 * document it runs against is not the one just installed (#888, and its
 * duplicate #887).  That is the SYMPTOM, and it is what this gate detects.
 *
 * The CAUSE is the issue's recorded diagnosis — `CDPClient.evaluate` omits
 * `contextId`, so `Runtime.evaluate` targets the frame's *default* execution
 * context, and replacing the document disturbs exactly that — and this change
 * does not establish it.  It is deliberately not relied on either: the gate
 * below waits for a *positive* observation through the caller's own call path,
 * so it holds whatever the underlying mechanism turns out to be.  A future
 * reader deciding whether this can be simplified away should treat the
 * mechanism as an open hypothesis rather than as settled by this file.
 *
 * ## Why a sentinel poll, and not the context-created signal
 *
 * The issue offered two remedy directions; the first is not available.
 * Measured on 2026-09-04 against headless Chromium, with `Runtime.enable` sent
 * explicitly for the measurement — which `CDPClient` itself never sends, so
 * these events do not reach this helper at runtime at all:
 * `Page.setDocumentContent` emitted `Runtime.executionContextDestroyed` on the
 * first round only, and **never** emitted `Runtime.executionContextCreated` —
 * not immediately, not 750 ms later, on any round.  A helper that awaited that
 * signal would block until its own deadline on every single install.
 *
 * Two cheaper-looking gates are unsound, both for the same reason: they
 * establish *absence* of the old state rather than *presence* of the new one,
 * and absence is satisfied by any wrong document, including a fresh empty one.
 * Concretely — `window` properties set before the replacement **survive** it,
 * so poisoning the old context proves nothing; and an attribute stamped on the
 * old `document.documentElement` does *not* survive, but neither would it
 * appear on a blank document, so its disappearance is not evidence that the
 * installed markup arrived.  (Those two observations also sit in tension with
 * a plain reading of the recorded cause, which is part of why the paragraph
 * above declines to assert it.)
 *
 * What this does instead is positive: it appends a marker carrying a token
 * unique to this install, then polls until an `evaluate` — the ordinary
 * no-`contextId` call, the exact one the assertions make — *finds* that
 * marker.  Only the document just installed carries it.  A blank document, a
 * stale one, and a half-installed one all fail the check identically, and the
 * helper keeps trying rather than returning.
 *
 * The marker is removed by the same evaluation that observes it, so the
 * document the caller gets back is the markup it asked for and nothing else.
 * That also makes the *last* thing this helper did through `client.evaluate` a
 * successful read of the installed document — which is the strongest form the
 * postcondition can take without threading an explicit `contextId` through
 * every call site.
 *
 * ## Bounds, stated rather than implied
 *
 * The marker is appended after the caller's markup, where the parser reparents
 * it into `<body>`.  Markup ending anywhere that leaves the marker unreachable
 * from `document.querySelector` therefore makes this helper time out.  The
 * class is "the parser is not in a state that produces a queryable element",
 * and it is wider than "malformed": measured against headless Chromium, it
 * covers an unterminated tag or comment, `<plaintext>`, every RAWTEXT and
 * RCDATA element (`<script>`, `<style>`, `<textarea>`, `<title>`, `<xmp>`,
 * `<iframe>`, `<noframes>`, `<noembed>`), a frameset document, and
 * `<template>` — which is the instructive one, since it is perfectly
 * well-formed and merely puts the marker in a content fragment
 * `document.querySelector` does not see.  Treat that as instances of the
 * class, not as a closed list.  All of them fail loudly, which is the
 * direction to fail in: the behaviour this replaces was a silent zero.  Both
 * captured fixtures in the tree end with `</html>`, so none of this is live
 * exposure today.
 *
 * Errors thrown by an individual gate attempt are absorbed and retried: a
 * `Runtime.evaluate` issued while the context is in flux can legitimately come
 * back as an error, and that is the very window being waited out.  The
 * deadline is what keeps absorption from becoming silence — the last error
 * seen at all is quoted in the timeout, and is not cleared by later attempts
 * that merely report the marker absent.
 *
 * The success path removes the marker in the same evaluation that observes it,
 * which is not idempotent: an evaluation whose *response* is lost after it ran
 * in the page leaves no marker for the retry to find, so the gate would
 * misreport a correct install as a failed one.  That is unreachable while the
 * gate deadline is shorter than the client's own request timeout — the lost
 * response surfaces as a rejection, and the deadline has already passed — so
 * a caller raising `timeout` past that should know it is trading this bound
 * away.
 *
 * @param client - A connected client for the target holding the document.
 * @param html - The complete document to install.
 * @param options.timeout - Budget for the *gate*, in ms, measured from the
 *   moment the markup has been sent (default {@link DEFAULT_GATE_TIMEOUT_MS}).
 *   It deliberately does not cover the install itself, so that a slow runner
 *   spends its slowness on the install and still gets the full retry window.
 *   It also cannot interrupt a single in-flight request — that is bounded by
 *   the client's own timeout — so the elapsed total is reported alongside it.
 *   At least one attempt is always made, whatever this is set to.
 * @param options.pollInterval - Pause between gate attempts, in ms (default 20).
 * @throws {CDPTimeoutError} If the installed document never becomes
 *   observable before the deadline.
 */
export async function installDocument(
  client: CDPClient,
  html: string,
  options?: { timeout?: number; pollInterval?: number },
): Promise<void> {
  const timeout = options?.timeout ?? DEFAULT_GATE_TIMEOUT_MS;
  const pollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL_MS;
  const startedAt = Date.now();

  installSequence += 1;
  const token = `${installSequence.toString(36)}-${Date.now().toString(36)}`;
  const selector = `meta[name="${SENTINEL_NAME}"][content="${token}"]`;

  const { frameTree } = (await client.send("Page.getFrameTree", {})) as {
    frameTree: { frame: { id: string } };
  };

  await client.send("Page.setDocumentContent", {
    frameId: frameTree.frame.id,
    html: `${html}<meta name="${SENTINEL_NAME}" content="${token}">`,
  });

  // Observe-and-remove in one evaluation: whichever document this lands in,
  // it only reports success for the one carrying THIS install's token.
  const claimSentinel = `(() => {
    const el = document.querySelector(${jsString(selector)});
    if (el === null) { return false; }
    el.remove();
    return true;
  })()`;

  const deadline = Date.now() + timeout;
  // Retained across later attempts on purpose.  An attempt that errors and is
  // then followed by clean `false` reads is exactly the interesting case, and
  // clearing it here would leave the timeout below claiming nothing went
  // wrong -- the silence this absorption is supposed to avoid.
  let lastError: unknown;
  for (;;) {
    try {
      if (await client.evaluate<boolean>(claimSentinel)) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    // Negated rather than written as `>= deadline`, which is not the same
    // predicate: every comparison against a non-finite deadline is false, so
    // `>=` would keep this loop running forever on a `timeout` that is not a
    // real number.  "Not still inside the budget" terminates on any deadline
    // that is not a future instant, which is the property wanted here -- a
    // hung helper is a worse failure than any it guards against.
    if (!(Date.now() < deadline)) {
      const cause =
        lastError === undefined
          ? ""
          : `; last evaluation error: ${lastError instanceof Error ? lastError.message : String(lastError)}`;
      throw new CDPTimeoutError(
        `Installed document did not become observable within its ` +
          `${timeout.toString()}ms gate budget ` +
          `(${(Date.now() - startedAt).toString()}ms elapsed since install began; ` +
          `sentinel ${token} never matched)${cause}`,
      );
    }

    await delay(pollInterval);
  }
}
