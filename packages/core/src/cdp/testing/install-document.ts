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
 * quirks mode (`BackCompat`), where layout — and therefore every geometry read
 * — is answered under different rules.
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
 * install N's leftovers on a run where the removal never landed.  It advances
 * per *attempt*, not per call, so a retry cannot be satisfied by the document
 * the attempt before it installed either.
 */
let installSequence = 0;

/**
 * How long a single attempt keeps re-checking before being written off.
 *
 * Sized against the *observed* failure rather than against a guess.  The first
 * windows run of this gate — CI run 33885243566, windows-latest, 2026-09-04 —
 * polled cleanly for 3 106 ms and never saw the marker: at the 20 ms interval
 * below that is roughly 150 evaluations, none of which errored, which says the
 * document stays unobservable *persistently* on that runner, not for a few
 * milliseconds.  Raising this alone would therefore not have helped; it is the
 * per-attempt slice of the retry below, which is the part that recovers.
 *
 * Three seconds already covered the install itself — measured 2026-09-04 on
 * macOS/arm64 against the 352 KB captured fixture, where the first install of a
 * suite took ~600 ms and later ones a few ms — so five buys margin on a
 * contended runner without being the mechanism anything relies on.  Re-measure
 * on the runner that matters before treating it as a ceiling.
 */
export const DEFAULT_GATE_TIMEOUT_MS = 5_000;

/** Pause between polls inside one gate.  Invisible in the happy path. */
export const DEFAULT_POLL_INTERVAL_MS = 20;

/**
 * How many times the whole install is driven before the helper gives up.
 *
 * More than one because a gate that only *detects* the fault leaves the suite
 * as red as the silent zero did — louder and better diagnosed, but still red,
 * and the acceptance bar for #888 is that windows CI passes repeatedly.
 *
 * Three rather than two or four is a judgement, not a computation, and is
 * recorded as one.  Each retry navigates away and installs a fresh document, so
 * the attempts are close to independent and the failure rate that matters is
 * the per-attempt one cubed; but the per-attempt rate is exactly what nobody
 * has measured — the pre-fix evidence counts *canaries* (about one in 2 068
 * across all four install sites) rather than installs, and the two are not the
 * same denominator.  So three buys two independent retries at a bounded
 * worst-case wall clock, and a fourth is available to whoever measures the
 * per-attempt rate and finds it wanting.
 */
export const DEFAULT_INSTALL_ATTEMPTS = 3;

/**
 * The per-test budget a suite that installs documents has to declare.
 *
 * Exported so the relationship is checkable rather than folklore: the helper's
 * own worst case is {@link DEFAULT_INSTALL_ATTEMPTS} gate budgets *plus* the
 * one-fewer reset waits between them — the reset is handed the same budget the
 * gate gets — and a consumer whose `it` blocks run on vitest's undeclared
 * 5 000 ms default would
 * be aborted by the runner long before the helper reached its own diagnostic.
 * A gate whose message cannot be printed is the failure this file exists to
 * replace, one level up.  Consuming suites pass this to `describe`, which
 * applies it to every test beneath.
 *
 * Scoped honestly: this bounds the budgets this file *sets*, and the remaining
 * headroom is an allowance for the round trips between them — not a bound on
 * them.  Every request here is bounded by the client's own timeout instead
 * (15 000 ms in all five consuming suites), so a runner sick enough to hang
 * several requests to that limit will still be aborted by vitest rather than
 * print the diagnostic.  Raising this constant far enough to cover that case
 * would trade a lost diagnostic for a suite that hangs for minutes on genuine
 * breakage, which is the worse of the two.
 */
export const INSTALL_TEST_TIMEOUT_MS = 60_000;

/** Reads a thrown value the way a log line wants it. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What the page looks like at the moment the helper gives up.
 *
 * Attached to the failure so the *next* windows failure is diagnosable from its
 * log alone.  The readings separate the hypotheses that a bare "sentinel never
 * matched" cannot: a document of roughly the installed size with zero sentinels
 * says the markup arrived and the marker was lost, while a near-empty document
 * says the evaluation is answering from somewhere the install never reached.
 */
const PAGE_PROBE = `(() => {
  try {
    return JSON.stringify({
      url: location.href,
      readyState: document.readyState,
      documentLength:
        document.documentElement === null
          ? -1
          : document.documentElement.outerHTML.length,
      bodyChildren: document.body === null ? -1 : document.body.children.length,
      sentinels: document.querySelectorAll(
        ${jsString(`meta[name="${SENTINEL_NAME}"]`)},
      ).length,
    });
  } catch (error) {
    return "probe threw: " + String(error);
  }
})()`;

async function probePage(client: CDPClient): Promise<string> {
  try {
    return await client.evaluate<string>(PAGE_PROBE);
  } catch (error) {
    // The probe is diagnostic, never load-bearing: a page too broken to
    // describe itself must not replace the failure being reported with its own.
    return `unreadable (${describeError(error)})`;
  }
}

/**
 * Return the frame to a document nobody installed, and do not come back until
 * that navigation has actually landed.
 *
 * Sent through `client.send` rather than `client.navigate`, which refuses every
 * scheme other than http(s) — a guard that is right for production callers and
 * exactly wrong here.  The point of the navigation is the side effect the
 * install itself does not produce: `Page.navigate` tears the frame's document
 * down and builds a new one, which is the only lever this helper has on the
 * execution context an un-parameterised `Runtime.evaluate` resolves to.
 *
 * The load wait is not ceremony, and skipping it would have re-opened the very
 * bug this file closes.  `Page.navigate` comes back when the navigation has
 * been *initiated* — `react-to-comment.ts` says so in as many words, and every
 * production navigate site that then depends on the new document pairs the call
 * with an explicit readiness wait for that reason.  (`navigate-away.ts` is the
 * one that does not, and it sleeps instead; it is also the only one that does
 * not care what it lands on.)  Returning on initiation lets the pending
 * `about:blank` commit land *after* the next attempt has installed its markup
 * and after the gate has observed it, so the caller's assertions would run
 * against a blank page and count `0` for every selector: #888's exact
 * signature, re-entering through the recovery added to close it.
 *
 * So a reset that cannot be *confirmed* is reported rather than assumed.
 * Installing into a frame that may still be navigating is the one move this
 * helper must never make, and "the request came back" is not evidence that it
 * is not.
 *
 * @returns `null` once the reset has been observed to land, or a description of
 *   why it could not be confirmed.
 */
async function resetFrame(
  client: CDPClient,
  timeout: number,
): Promise<string | null> {
  try {
    // Enabled around the wait and disabled after, per the idiom the production
    // navigate sites use: the Page domain is off by default on this client, so
    // `Page.loadEventFired` would otherwise never be delivered at all.
    await client.send("Page.enable");
  } catch (error) {
    return `reset could not enable the Page domain: ${describeError(error)}`;
  }

  try {
    // Subscribed BEFORE the navigation is issued.  Subscribing after it would
    // race the very event being waited for on a document as cheap to load as
    // `about:blank`.
    const loaded = client.waitForEvent("Page.loadEventFired", timeout);
    await client.send("Page.navigate", { url: "about:blank" });
    await loaded;
    return null;
  } catch (error) {
    return `reset to about:blank did not commit: ${describeError(error)}`;
  } finally {
    await client.send("Page.disable").catch(() => undefined);
  }
}

/**
 * Install once and gate on it, reporting why rather than throwing.
 *
 * @returns `null` once the installed document is observable, or a description
 *   of what this attempt saw instead.
 */
async function driveInstall(
  client: CDPClient,
  html: string,
  timeout: number,
  pollInterval: number,
): Promise<string | null> {
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
  // it only reports success for the one carrying THIS attempt's token.
  const claimSentinel = `(() => {
    const el = document.querySelector(${jsString(selector)});
    if (el === null) { return false; }
    el.remove();
    return true;
  })()`;

  // A non-finite budget is not a longer wait, it is a hung helper: `Date.now()
  // < Infinity` is true forever, and every comparison against `NaN` is false.
  // Both collapse to "no budget left", which fails loudly after one poll --
  // strictly better than a test that never returns.
  const deadline = Number.isFinite(timeout) ? Date.now() + timeout : Date.now();
  // Retained across later polls on purpose.  A poll that errors and is then
  // followed by clean `false` reads is exactly the interesting case, and
  // clearing it here would leave the report below claiming nothing went wrong
  // -- the silence this absorption is supposed to avoid.
  let lastError: unknown;
  for (;;) {
    try {
      // Compared against `true` rather than tested for truthiness: the type
      // parameter on `evaluate` is a trust assertion and not a runtime check
      // (`CDPClient.evaluate` casts with `as T`), so an evaluation whose result
      // has no `value` arrives here as `undefined`.  Anything that is not
      // literally `true` means the marker was not observed, and treating it as
      // success would hand back exactly the unconfirmed document this file
      // exists to refuse.
      if ((await client.evaluate<boolean>(claimSentinel)) === true) {
        return null;
      }
    } catch (error) {
      lastError = error;
    }

    // The deadline is finite by construction above, so this is an ordinary
    // budget check.  Written negated because that reading -- "not still inside
    // the budget" -- is the one that stays correct if the normalisation above
    // is ever relaxed.
    if (!(Date.now() < deadline)) {
      const cause =
        lastError === undefined
          ? ""
          : `, last evaluation error: ${describeError(lastError)}`;
      return `sentinel ${token} never matched${cause}`;
    }

    await delay(pollInterval);
  }
}

/**
 * Install `html` as the live document, and do not return until that document
 * is observable through the same channel the caller's assertions will use.
 *
 * ## The symptom this closes, and what is NOT claimed about its cause
 *
 * Every Tier-2 fixture site did the same two steps: `Page.setDocumentContent`
 * to install markup, then `client.evaluate("document.querySelectorAll(…).length")`
 * to count.  On the windows runner, roughly once per full run across all four
 * install sites and on a different canary each time, the count came back `0`
 * for *every* selector on
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
 * Concretely, measured in the same session and on the same harness — `window`
 * properties set before the replacement **survive** it, so poisoning the old
 * context proves nothing; and an attribute stamped on the old
 * `document.documentElement` does *not* survive, but neither would it appear
 * on a blank document, so its disappearance is not evidence that the installed
 * markup arrived.  (Those two observations also sit in tension with
 * a plain reading of the recorded cause, which is part of why the paragraph
 * above declines to assert it.)
 *
 * What this does instead is positive: it appends a marker carrying a token
 * unique to this attempt, then polls until an `evaluate` — the ordinary
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
 * ## Detecting is not enough: why the install is re-driven
 *
 * The first windows run of this gate is the reason the loop exists.  It polled
 * for 3 106 ms — on the order of 150 evaluations, every one of them a clean
 * `false` with no error to absorb — and the document never became observable.
 * So the fault is not a brief window to be waited out on one document; that
 * document stays unobservable for as long as anyone looks at it, and a helper
 * that only waits converts a silent wrong answer into a loud red suite.  Better,
 * and still not the acceptance bar, which is that windows CI passes repeatedly.
 *
 * So a failed attempt is not the end: the frame is navigated to `about:blank`,
 * that navigation is *waited out* rather than assumed, and the whole install is
 * driven again with a fresh token, up to
 * {@link DEFAULT_INSTALL_ATTEMPTS} times.  The navigation is the part that
 * distinguishes a retry from more polling — it replaces the frame's document
 * outright, which is the one lever available on the execution context an
 * un-parameterised `Runtime.evaluate` resolves to.  Whether that is what
 * actually recovers is a *prediction* this change makes and does not verify:
 * the mechanism is the same open hypothesis the section above declines to
 * assert, so the failure carries a page probe precisely so the next occurrence
 * is decidable from its log rather than from another round of guessing.
 *
 * Retrying is safe to do blindly because installing is idempotent by
 * construction: each attempt replaces the entire document, and each carries a
 * token no earlier attempt used, so no attempt can be satisfied by what an
 * earlier one left behind.  The happy path is unaffected — it returns from the
 * first attempt, and never navigates.
 *
 * ## Bounds, stated rather than implied
 *
 * The marker is appended after the caller's markup, where the parser reparents
 * it into `<body>`.  Markup ending anywhere that leaves the marker unreachable
 * from `document.querySelector` therefore makes this helper time out.  The
 * class is "the parser is not in a state that produces a queryable element",
 * and it is wider than "malformed".  Measured 2026-09-04 against headless
 * Chromium: an unterminated tag or comment, `<plaintext>`, a frameset
 * document, RAWTEXT and RCDATA elements (`<script>`, `<style>`, `<textarea>`,
 * `<title>`, `<xmp>`, `<iframe>`, `<noframes>`, `<noembed>` were the ones
 * probed; `<noscript>` joins them wherever scripting is enabled, which it is
 * here), and `<template>` — the instructive one, since it is perfectly
 * well-formed and merely puts the marker in a content fragment
 * `document.querySelector` does not see.  Those are instances of the class,
 * not a closed list, and one representative is exercised rather than all.  All
 * of them fail loudly, which is the direction to fail in: the behaviour this
 * replaces was a silent zero.  Note that such markup now costs
 * {@link DEFAULT_INSTALL_ATTEMPTS} full budgets rather than one, since nothing
 * distinguishes "unparseable" from "unobservable" from outside.  Both captured
 * fixtures in the tree end with `</html>`, so none of this is live exposure
 * today.
 *
 * Errors thrown by an individual poll are absorbed and retried: a
 * `Runtime.evaluate` issued while the context is in flux can legitimately come
 * back as an error, and that is the very window being waited out.  The
 * deadline is what keeps absorption from becoming silence — the last error
 * seen at all is quoted in that attempt's line of the failure, and is not
 * cleared by later polls that merely report the marker absent.  Errors thrown
 * by the install *requests* are not absorbed: they propagate as themselves,
 * because a dead connection is not the fault this helper waits out and
 * relabelling it as a gate timeout would bury it.
 *
 * The success path removes the marker in the same evaluation that observes it,
 * which is not idempotent: an evaluation whose *response* is lost after it ran
 * in the page leaves no marker for a later poll to find, so the gate misreports
 * a correct install as a failed one.  This is a standing bound, not one some
 * timeout relationship removes.  A dropped socket rejects the pending request
 * *promptly* (`CDPClient` rejects everything in flight when the WebSocket
 * closes), so the rejection can land well inside the deadline and the loop
 * then retries against a document whose marker is already gone.  The retry
 * above narrows this rather than closing it — a subsequent attempt installs a
 * fresh document and a fresh marker, so the misreport now has to recur on
 * every attempt to become a failure.  It is bounded in consequence rather than
 * in reachability: the failure direction is a loud, wrong diagnosis, never a
 * silently accepted document, which is the trade this whole helper exists to
 * make.
 *
 * @param client - A connected client for the target holding the document.
 * @param html - The complete document to install.
 * @param options.timeout - Budget for a single *gate*, in ms, measured from the
 *   moment that attempt's markup has been sent (default
 *   {@link DEFAULT_GATE_TIMEOUT_MS}).  The same value bounds the load-event wait
 *   each reset performs, so a run's worst case is this many gates plus one
 *   fewer resets.  It deliberately does not cover the
 *   install itself, so that a slow runner spends its slowness on the install
 *   and still gets the full retry window.  It also cannot interrupt a single
 *   in-flight request — that is bounded by the client's own timeout — so the
 *   elapsed total is reported alongside it.  At least one poll is always made,
 *   whatever this is set to.
 * @param options.pollInterval - Pause between polls, in ms
 *   (default {@link DEFAULT_POLL_INTERVAL_MS}).
 * @param options.attempts - How many times the whole install is driven
 *   (default {@link DEFAULT_INSTALL_ATTEMPTS}).  At least one attempt is always
 *   made, whatever this is set to.
 * @throws {CDPTimeoutError} If no attempt makes the installed document
 *   observable.
 */
export async function installDocument(
  client: CDPClient,
  html: string,
  options?: { timeout?: number; pollInterval?: number; attempts?: number },
): Promise<void> {
  const timeout = options?.timeout ?? DEFAULT_GATE_TIMEOUT_MS;
  const pollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL_MS;
  const requested = options?.attempts ?? DEFAULT_INSTALL_ATTEMPTS;
  // Never zero, never fractional, never non-finite.  A count of `0` -- or of
  // `NaN`, or of `Infinity` -- must not mean "return success having installed
  // nothing" or "retry forever": the first is the silent wrong answer this file
  // exists to remove, re-entering through the front door of its own recovery
  // option, and the second is a test that never finishes.
  const lastAttempt = Number.isFinite(requested)
    ? Math.max(1, Math.floor(requested))
    : 1;
  const startedAt = Date.now();

  const failures: string[] = [];
  for (let attempt = 1; attempt <= lastAttempt; attempt += 1) {
    if (attempt > 1) {
      const reset = await resetFrame(client, timeout);
      if (reset !== null) {
        // Installing into a frame that may still be navigating is the one move
        // this helper must never make, so an unconfirmed reset ends the attempt
        // rather than being installed through.
        failures.push(`attempt ${attempt.toString()}: ${reset}`);
        continue;
      }
    }

    let failure: string | null;
    try {
      failure = await driveInstall(client, html, timeout, pollInterval);
    } catch (error) {
      // A failed install REQUEST is not the window the gate waits out, so it is
      // never absorbed into a gate timeout -- on the last attempt it propagates
      // as itself, because relabelling a dead connection would bury it.  Before
      // then it is worth one more try, and recording it keeps the eventual
      // report from losing the attempts that came before.
      if (attempt === lastAttempt) {
        throw error;
      }
      failures.push(
        `attempt ${attempt.toString()}: install request failed: ${describeError(error)}`,
      );
      continue;
    }

    if (failure === null) {
      return;
    }
    failures.push(`attempt ${attempt.toString()}: ${failure}`);
  }

  // Read before probing: the probe runs after the helper has already given
  // up, so folding its round trip into "elapsed" would overstate the wait on
  // exactly the runs worth diagnosing.
  const elapsed = Date.now() - startedAt;
  const pageState = await probePage(client);
  throw new CDPTimeoutError(
    `Installed document did not become observable in ` +
      `${failures.length.toString()} attempt(s) of ${timeout.toString()}ms each ` +
      `(${elapsed.toString()}ms elapsed since the first install began) -- ` +
      `${failures.join("; ")}; page state at giving up: ${pageState}`,
  );
}
