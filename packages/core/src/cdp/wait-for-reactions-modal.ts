// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delay } from "../utils/delay.js";
import type { CDPClient } from "./client.js";
import { ensureSecureDiagnosticDir } from "./wait-for-post-load.js";

// ----------------------------------------------------------------------------
// Selectors used by both the readiness predicate ({@link waitForReactionsModal})
// and the diagnostic probe ({@link captureReactionsModalFailure}).
// Centralizing them keeps the two aligned: a future timeout's "which-of-three-
// is-missing" signal stays accurate by definition.
// ----------------------------------------------------------------------------

/**
 * Reactions modal wrapper — the standard ARIA dialog LinkedIn opens after
 * the user clicks the reactions count beneath a post.  This selector has
 * been stable across LinkedIn UI revisions; the probe still reports
 * `dialogCount` so a future change away from `[role="dialog"]` lands as
 * a precise diagnostic signal rather than a generic timeout.
 */
const REACTIONS_MODAL_SELECTOR = '[role="dialog"]';

/**
 * Engager profile link inside the modal — each engager entry contains an
 * `<a href="/in/{slug}">` linking to that person's profile.  Used both
 * by the readiness predicate (presence ⇒ engager rows hydrated) and by
 * the diagnostic probe (`dialogHasInLinks`).
 */
const REACTIONS_MODAL_ENGAGER_LINK_SELECTOR = 'a[href*="/in/"]';

/**
 * Poll the DOM until the reactions modal has loaded with at least one
 * profile link visible.
 *
 * Issue #773 Phase 1: this helper was lifted from `get-post-engagers.ts`
 * (where it lived as a local function) to a shared module so the same
 * diagnostic-capture pattern that pinned the post-detail regression in
 * #762 / #771 (PR #770 / PR #772) can apply here.  The lifted predicate
 * is unchanged — Phase 2 will update it per diagnostic data captured
 * on the next E2E timeout.
 *
 * On timeout, if `LHREMOTE_CAPTURE_DIAGNOSTICS=1`, a best-effort
 * diagnostic capture is written to a per-invocation
 * `${os.tmpdir()}/lhremote-diagnostics-XXXXXX/` directory before the
 * error propagates; see {@link captureReactionsModalFailure}.  Opt-in
 * because the LinkedIn engager modal can include personal data
 * (engager names, profile slugs, headlines).
 *
 * @param client    - Connected CDP client targeting a LinkedIn page.
 * @param timeoutMs - Polling deadline in milliseconds (default: 10s).
 *
 * @throws If the modal predicate does not match before the deadline.
 */
export async function waitForReactionsModal(
  client: CDPClient,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate<boolean>(`(() => {
      const modal = document.querySelector('${REACTIONS_MODAL_SELECTOR}');
      if (!modal) return false;
      return modal.querySelectorAll('${REACTIONS_MODAL_ENGAGER_LINK_SELECTOR}').length > 0;
    })()`);
    if (ready) return;
    await delay(500);
  }
  // captureReactionsModalFailure self-gates on LHREMOTE_CAPTURE_DIAGNOSTICS
  // and swallows its own errors, so the original timeout always propagates
  // unchanged regardless of capture-side outcome.
  await captureReactionsModalFailure(client);
  throw new Error(
    "Timed out waiting for reactions modal to appear",
  );
}

/**
 * Cap on the wall-clock time the diagnostic capture is awaited before
 * the caller's timeout is re-thrown.  Without this, a misbehaving CDP
 * connection could prolong error propagation by up to `CDPClient.send`'s
 * own timeout per call (`Runtime.evaluate` + `Page.captureScreenshot`).
 */
const DIAGNOSTIC_CAPTURE_TIMEOUT_MS = 10_000;

/**
 * Mutable cancellation state shared between the outer wrapper and the
 * inner capture body.  The wrapper flips `timedOut` when the bound timer
 * wins the race; the inner body checks between each async step and
 * returns early, giving up any remaining writes so the process can exit
 * promptly.
 */
interface CaptureCancellationState {
  timedOut: boolean;
}

/**
 * Best-effort diagnostic capture when {@link waitForReactionsModal}
 * times out waiting for the reactions modal DOM.  Each invocation
 * creates a fresh `${os.tmpdir()}/lhremote-diagnostics-XXXXXX/`
 * directory via `mkdtemp` (atomic; refuses to follow any pre-existing
 * symlink at the prefix) and writes
 * `wait-for-reactions-modal-{timestamp}.json` (URL, dialog probes,
 * reactions-button candidates, body-text snippet) and a sibling `.png`
 * (full-page `Page.captureScreenshot` with `captureBeyondViewport: true`,
 * when the screenshot succeeds) inside it, so callers can classify the
 * failure — wrong click target, modal never opened, or modal opened
 * but engager-link selectors stale.  Per-invocation directories
 * prevent concurrent timeouts from clobbering each other's artifacts
 * AND close the TOCTOU window a shared parent directory would
 * otherwise leave open.  The trailing `console.warn` reports only the
 * artifacts that were actually written; the `.png` is best-effort and
 * may be absent.
 *
 * **Opt-in only.** Self-gated on `LHREMOTE_CAPTURE_DIAGNOSTICS=1` —
 * no-op otherwise.  Default-off in production (CLI, MCP server)
 * because the artifacts can contain personal data from the LinkedIn
 * engager list.  E2E tests activate it via `vitest.e2e.config.ts`
 * `env` so every run produces diagnostics without touching the
 * codebase.
 *
 * The diagnostics directory is created with mode `0o700` and files
 * with mode `0o600` (POSIX; no-op on Windows) so that personal data
 * in a shared `os.tmpdir()` is not exposed to other local users.
 *
 * The capture is cooperatively cancellable and bounded by
 * {@link DIAGNOSTIC_CAPTURE_TIMEOUT_MS}: the outer wrapper stops
 * awaiting at the cap, and the inner body checks a shared cancellation
 * flag between each step and returns early when it flips — so
 * remaining CDP calls and disk writes are skipped rather than merely
 * un-awaited.  In rare cases the in-flight async step started before
 * the cap may still complete in the background; the process is not
 * held alive by this function beyond the cap plus any such single
 * in-flight step.
 *
 * Any capture-side failure is swallowed so the original timeout
 * always propagates unchanged.
 *
 * Probe set: `{ href, dialogCount, dialogHasInLinks,
 * dialogChildElementCount, bodyTextSnippet, reactionsButtonAriaLabels,
 * reactionsCountText }` — distinguishes:
 *  1. "click never opened a dialog" (`dialogCount === 0`)
 *  2. "dialog opened but engager-link selectors stale"
 *     (`dialogCount > 0 && !dialogHasInLinks`)
 *  3. "wrong button was clicked" (`reactionsButtonAriaLabels` reveals
 *     which aria-labels exist on visible reaction-related buttons,
 *     and `reactionsCountText` reports what the
 *     `FIND_REACTIONS_SCRIPT` regex would currently match)
 *
 * Mirrors the diagnostic-capture pattern documented in ADR-007 for
 * `navigateToProfile` and `waitForPostLoad` — same env var, same
 * artifact structure, same cancellation discipline,
 * {@link ensureSecureDiagnosticDir} reused from `wait-for-post-load.ts`.
 *
 * @internal Exported for unit testing only; not part of the public API.
 */
export async function captureReactionsModalFailure(
  client: CDPClient,
): Promise<void> {
  if (process.env.LHREMOTE_CAPTURE_DIAGNOSTICS !== "1") return;
  const state: CaptureCancellationState = { timedOut: false };
  let bound: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      // Attach a no-op catch to the inner promise so a late rejection
      // (after the timer wins the race) does not escape as an
      // UnhandledPromiseRejection — capture-side errors must always be
      // swallowed to keep the caller's timeout propagating unchanged.
      captureReactionsModalFailureInner(client, state).catch(() => undefined),
      new Promise<void>((resolve) => {
        bound = setTimeout(() => {
          state.timedOut = true;
          resolve();
        }, DIAGNOSTIC_CAPTURE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Capture itself failed; do not mask the caller's timeout.
  } finally {
    if (bound !== undefined) clearTimeout(bound);
  }
}

async function captureReactionsModalFailureInner(
  client: CDPClient,
  state: CaptureCancellationState,
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  // mkdtemp is the atomic fresh-directory primitive: it generates a
  // random suffix and creates the directory in one syscall, refusing
  // to follow any pre-existing symlink at the prefix.  See
  // wait-for-post-load.ts capturePostLoadFailureInner for the full
  // TOCTOU rationale — ensureSecureDiagnosticDir is centralized
  // there; this site reuses it.
  const baseDir = await mkdtemp(join(tmpdir(), "lhremote-diagnostics-"));
  if (state.timedOut) return;
  if (!(await ensureSecureDiagnosticDir(baseDir))) return;
  if (state.timedOut) return;
  const prefix = join(baseDir, `wait-for-reactions-modal-${timestamp}`);

  const info = await client.evaluate<{
    href: string;
    dialogCount: number;
    dialogHasInLinks: boolean;
    dialogChildElementCount: number;
    bodyTextSnippet: string;
    reactionsButtonAriaLabels: string[];
    reactionsCountText: string | null;
  }>(`(() => {
    const dialogs = document.querySelectorAll('${REACTIONS_MODAL_SELECTOR}');
    const firstDialog = dialogs[0] || null;
    const dialogHasInLinks = firstDialog
      ? firstDialog.querySelectorAll('${REACTIONS_MODAL_ENGAGER_LINK_SELECTOR}').length > 0
      : false;
    const dialogChildElementCount = firstDialog ? firstDialog.childElementCount : 0;

    // Capture aria-labels of visible buttons whose label hints at
    // reactions / engagement — distinguishes "clicked the wrong button"
    // (e.g. clicked a generic "Like" toggle instead of the reactions
    // count summary) from "right button, modal selectors stale".  Cap
    // length and count to keep the artifact bounded.
    const reactionsButtonAriaLabels = Array.prototype.slice
      .call(document.querySelectorAll('button[aria-label]'))
      .map(function (el) { return (el.getAttribute('aria-label') || '').trim(); })
      .filter(function (label) {
        return /reaction|like|engager|comment/i.test(label) && label.length < 200;
      })
      .slice(0, 30);

    // Capture the text the FIND_REACTIONS_SCRIPT regex would currently
    // match — pins what the click target looks like at timeout time so
    // Phase 2 can decide whether the regex itself needs updating.
    const reactionsCountElements = Array.prototype.slice
      .call(document.querySelectorAll('button, [role="button"], span, a'))
      .filter(function (el) {
        const t = (el.textContent || '').trim();
        return /^\\d[\\d,]*\\s+reactions?$/i.test(t) && el.offsetHeight > 0;
      });
    const reactionsCountText = reactionsCountElements[0]
      ? (reactionsCountElements[0].textContent || '').trim()
      : null;

    return {
      href: location.href,
      dialogCount: dialogs.length,
      dialogHasInLinks: dialogHasInLinks,
      dialogChildElementCount: dialogChildElementCount,
      bodyTextSnippet: (document.body ? document.body.innerText : "").slice(0, 800),
      reactionsButtonAriaLabels: reactionsButtonAriaLabels,
      reactionsCountText: reactionsCountText,
    };
  })()`);
  if (state.timedOut) return;

  // 0o600: owner-only rw.  POSIX-only; no-op on Windows.
  await writeFile(`${prefix}.json`, JSON.stringify(info, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  if (state.timedOut) {
    // Cap fired after JSON landed but before screenshot.  Surface the
    // path NOW — the per-invocation mkdtemp directory is the only
    // place these artifacts live, so an early return without a warn
    // would leave operators unable to find them.
    console.warn(
      `[waitForReactionsModal] timeout diagnostics partial: ${prefix}.json (screenshot skipped — capture cap reached)`,
    );
    return;
  }

  let wroteScreenshot = false;
  try {
    const screenshot = (await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    })) as { data?: string };
    if (!state.timedOut && screenshot.data) {
      await writeFile(`${prefix}.png`, Buffer.from(screenshot.data, "base64"), {
        mode: 0o600,
      });
      wroteScreenshot = true;
    }
  } catch {
    // Screenshot is best-effort; info.json is the primary artifact.
  }

  // Unconditional warn — even if `state.timedOut` flipped during the
  // screenshot, we still have at least the JSON at the randomized
  // path, and the operator needs the path to find anything at all.
  // Mention `.png` only when actually written.
  const artifacts = wroteScreenshot ? "{json,png}" : "json";
  console.warn(
    `[waitForReactionsModal] timeout diagnostics written: ${prefix}.${artifacts}`,
  );
}
