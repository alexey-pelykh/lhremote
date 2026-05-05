// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delay } from "../utils/delay.js";
import type { CDPClient } from "./client.js";
import { ensureSecureDiagnosticDir } from "./wait-for-post-load.js";

// ----------------------------------------------------------------------------
// Selectors used by the readiness predicate, the diagnostic probe, and the
// modal resolver shared with `get-post-engagers.ts` (scrape / scroll / total).
// Centralizing them keeps the call sites aligned: a future regression in
// "which selector matches the engager modal" lands as a precise diagnostic
// signal rather than a generic timeout.
// ----------------------------------------------------------------------------

/**
 * Reactions modal wrapper — ordered fallback chain.  LinkedIn's 2026-05
 * markup refresh removed the `[role="dialog"]` ARIA wrapper from the
 * engager modal (Phase 1 diagnostic capture, JSON `dialogCount: 0`
 * while the modal IS visible in `bodyTextSnippet` — see #773).
 *
 * Tried sequentially by the resolver, in this order — first match wins:
 *   1. `dialog`               — HTML5 native dialog
 *   2. `[aria-modal="true"]`  — ARIA standard for modal regions
 *   3. `[role="dialog"]`      — defensive retention (legacy markup)
 *
 * `querySelector` with a comma-joined selector list returns the first
 * match in **document order**, not in the order the selectors are
 * listed.  That breaks the precedence claim above when multiple
 * candidate wrappers coexist on the page (e.g. engager modal +
 * unrelated dialog).  An array iterated by the resolver enforces real
 * precedence.  Used by the readiness predicate
 * ({@link waitForReactionsModal}) and shared via
 * {@link RESOLVE_REACTIONS_MODAL_SCRIPT} with the diagnostic probe and
 * the scrape / scroll / total scripts in `get-post-engagers.ts`.
 */
const REACTIONS_MODAL_WRAPPER_SELECTORS: readonly string[] = [
  "dialog",
  '[aria-modal="true"]',
  '[role="dialog"]',
];

/**
 * Tab-anchor fallback selector — the "All reactions" filter button
 * that sits at the top of the open engager modal.  Used when none of
 * the canonical wrappers match: walk up from the tab to find the
 * modal-like ancestor that contains the engager links.  The button
 * aria-label has stayed stable across the 2026-05 refresh
 * (`reactionsButtonAriaLabels` in the diagnostic JSON includes
 * "24 All reactions") even though the wrapper element shape shifted.
 */
const REACTIONS_TAB_FALLBACK_SELECTOR =
  'button[aria-label$=" All reactions"]';

/**
 * Engager profile link inside the modal — each engager entry contains an
 * `<a href="/in/{slug}">` linking to that person's profile.  Used both
 * by the readiness predicate (presence ⇒ engager rows hydrated), the
 * modal resolver (anchor-walk termination signal), and the diagnostic
 * probe (`dialogHasInLinks`).
 */
const REACTIONS_MODAL_ENGAGER_LINK_SELECTOR = 'a[href*="/in/"]';

/**
 * Maximum ancestor depth the tab-anchor fallback walks up from the
 * "All reactions" button.  12 is generous: it crosses the modal
 * wrapper plus typical layout chrome (toolbar, root-of-modal,
 * portal-host) without risking a runaway walk into `<body>` if the
 * page structure changes.
 */
const REACTIONS_MODAL_ANCESTOR_WALK_DEPTH = 12;

/**
 * In-page JavaScript that resolves the engager modal element via the
 * fallback chain (canonical wrappers → tab-anchor walk).  Defines a
 * function `__getReactionsModal()` that returns either the resolved
 * `Element` or `null`.  Prepended to every consumer that needs the
 * resolved modal — the readiness predicate ({@link waitForReactionsModal}),
 * the diagnostic probe ({@link captureReactionsModalFailure}), and the
 * scrape / scroll / total scripts in `get-post-engagers.ts` — so all
 * call sites share a single resolution rule.  String form (not a
 * function) because each call site composes a separate
 * `Runtime.evaluate` script.
 *
 * Exported for reuse from `get-post-engagers.ts`.
 */
export const RESOLVE_REACTIONS_MODAL_SCRIPT = `
function __getReactionsModal() {
  // Stage 1: try the canonical wrapper selectors in precedence order.
  // For each selector, iterate ALL matches and validate each one —
  // accept only candidates that contain the "All reactions" filter
  // tab OR at least one engager profile link.  Without this gate, an
  // unrelated \`<dialog>\` / \`[aria-modal="true"]\` / \`[role="dialog"]\`
  // rendered earlier in the DOM (cookie banner, unrelated overlay)
  // would shadow the actual engager modal — Stage 1 would return the
  // wrong element, Stage 2 would never run, and the predicate would
  // poll until timeout while the real modal is open.  Per #773 Phase 1
  // diagnostics, LinkedIn dropped \`[role="dialog"]\` from the engager
  // modal in 2026-05; the broader list lets future restorations take
  // effect without a code change.
  const wrapperSelectors = ${JSON.stringify(REACTIONS_MODAL_WRAPPER_SELECTORS)};
  for (let i = 0; i < wrapperSelectors.length; i++) {
    const candidates = document.querySelectorAll(wrapperSelectors[i]);
    for (let j = 0; j < candidates.length; j++) {
      const c = candidates[j];
      if (
        c.querySelector('${REACTIONS_TAB_FALLBACK_SELECTOR}') ||
        c.querySelector('${REACTIONS_MODAL_ENGAGER_LINK_SELECTOR}')
      ) {
        return c;
      }
    }
  }
  // Stage 2: walk up from the "All reactions" filter tab to find the
  // modal-like ancestor.  Reached when no canonical wrapper holds the
  // engager modal — either none exists (LinkedIn's 2026-05 state per
  // Phase 1 diagnostics: zero matching dialog wrappers) or the
  // wrapper is some other shape entirely.  The tab aria-label stayed
  // stable across the refresh; its closest ancestor that holds
  // engager links IS the modal.  Bounded depth so a
  // missing-engager-links page doesn't infinite-loop.
  const tab = document.querySelector('${REACTIONS_TAB_FALLBACK_SELECTOR}');
  if (!tab || tab.offsetHeight === 0) return null;
  let ancestor = tab.parentElement;
  let depth = 0;
  while (ancestor && depth < ${REACTIONS_MODAL_ANCESTOR_WALK_DEPTH}) {
    if (ancestor.querySelectorAll('${REACTIONS_MODAL_ENGAGER_LINK_SELECTOR}').length > 0) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
    depth++;
  }
  return null;
}
`;

/**
 * Poll the DOM until the reactions modal has loaded with at least one
 * profile link visible.
 *
 * Issue #773: the engager modal's `[role="dialog"]` wrapper disappeared
 * with LinkedIn's 2026-05 markup refresh (Phase 1 diagnostic capture
 * confirmed `dialogCount: 0` while the modal IS visually open — see
 * `reactionsButtonAriaLabels` and `bodyTextSnippet`).  This predicate
 * resolves the modal via {@link RESOLVE_REACTIONS_MODAL_SCRIPT}'s
 * fallback chain: canonical wrappers (`<dialog>` / `[aria-modal="true"]`
 * / `[role="dialog"]`) first, then a tab-anchor walk from the "All
 * reactions" filter button — whose aria-label stayed stable.  Engager
 * links inside the resolved element gate the predicate.
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
      ${RESOLVE_REACTIONS_MODAL_SCRIPT}
      const modal = __getReactionsModal();
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
 * reactionsCountText, htmlDialogCount, ariaModalCount, hasReactionsTab,
 * reactionsTabAncestorChain, resolvedModalAncestorTag }` —
 * distinguishes:
 *  1. "click never opened a dialog" (`dialogCount === 0` AND
 *     `htmlDialogCount === 0` AND `ariaModalCount === 0` AND
 *     `hasReactionsTab === false`)
 *  2. "dialog opened but engager-link selectors stale"
 *     (`dialogCount > 0 && !dialogHasInLinks`)
 *  3. "wrong button was clicked" (`reactionsButtonAriaLabels` reveals
 *     which aria-labels exist on visible reaction-related buttons,
 *     and `reactionsCountText` reports what the
 *     `FIND_REACTIONS_SCRIPT` regex would currently match)
 *  4. "modal opens but uses non-canonical wrapper" — at least one of
 *     `htmlDialogCount` / `ariaModalCount` / `hasReactionsTab` is
 *     non-zero/true; `reactionsTabAncestorChain` reveals which
 *     ancestor tag/role/aria-modal/class shape the modal wrapper
 *     actually has, so the resolver fallback chain in
 *     {@link RESOLVE_REACTIONS_MODAL_SCRIPT} can target it directly
 *  5. "resolver fallback walk found a candidate but engager links
 *     missing" — `resolvedModalAncestorTag` non-null but the predicate
 *     still failed; rare hydration race vs. actual selector miss
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
    htmlDialogCount: number;
    ariaModalCount: number;
    hasReactionsTab: boolean;
    reactionsTabAncestorChain: string[];
    resolvedModalAncestorTag: string | null;
  }>(`(() => {
    ${RESOLVE_REACTIONS_MODAL_SCRIPT}
    // Legacy dialog probe — preserved for continuity with the original
    // diagnostic shape; \`dialogCount === 0\` is the signal that pinned
    // #773 in Phase 1.
    const legacyDialogs = document.querySelectorAll('[role="dialog"]');
    const firstLegacyDialog = legacyDialogs[0] || null;
    const dialogHasInLinks = firstLegacyDialog
      ? firstLegacyDialog.querySelectorAll('${REACTIONS_MODAL_ENGAGER_LINK_SELECTOR}').length > 0
      : false;
    const dialogChildElementCount = firstLegacyDialog ? firstLegacyDialog.childElementCount : 0;

    // New wrapper-shape probes — distinguish "modal not opened at all"
    // from "modal opened but uses a different wrapper element".  If any
    // of these are non-zero / true while \`dialogCount === 0\`, the
    // resolver fallback in RESOLVE_REACTIONS_MODAL_SCRIPT must adapt.
    const htmlDialogCount = document.querySelectorAll('dialog').length;
    const ariaModalCount = document.querySelectorAll('[aria-modal="true"]').length;
    const reactionsTab = document.querySelector('${REACTIONS_TAB_FALLBACK_SELECTOR}');
    const hasReactionsTab = reactionsTab !== null && reactionsTab.offsetHeight > 0;

    // Walk up from the "All reactions" tab and capture each ancestor's
    // shape (tag, role, aria-modal, aria-labelledby presence, class
    // first-token) up to the same depth the resolver walks.  Lets a
    // future regression target the wrapper element directly without
    // another round of probe extension.
    const reactionsTabAncestorChain = [];
    if (reactionsTab) {
      let ancestor = reactionsTab.parentElement;
      let depth = 0;
      while (ancestor && depth < ${REACTIONS_MODAL_ANCESTOR_WALK_DEPTH}) {
        const tag = (ancestor.tagName || '').toLowerCase();
        const role = ancestor.getAttribute('role') || '';
        const ariaModal = ancestor.getAttribute('aria-modal') || '';
        const ariaLabelledBy = ancestor.getAttribute('aria-labelledby') ? 'yes' : '';
        // First class token only — bounds artifact size; full classlist
        // would balloon for utility-CSS-heavy pages.
        const classToken = ((ancestor.className && typeof ancestor.className === 'string')
          ? ancestor.className.trim().split(/\\s+/)[0]
          : '') || '';
        const inLinks = ancestor.querySelectorAll('${REACTIONS_MODAL_ENGAGER_LINK_SELECTOR}').length;
        reactionsTabAncestorChain.push(
          tag + (role ? ' role=' + role : '') +
          (ariaModal ? ' aria-modal=' + ariaModal : '') +
          (ariaLabelledBy ? ' aria-labelledby=yes' : '') +
          (classToken ? ' .' + classToken : '') +
          ' inLinks=' + inLinks
        );
        ancestor = ancestor.parentElement;
        depth++;
      }
    }

    // Did the resolver land?  Reports the resolved element's tag for
    // the "fallback found a candidate but predicate still failed" case.
    const resolvedModal = __getReactionsModal();
    const resolvedModalAncestorTag = resolvedModal
      ? (resolvedModal.tagName || '').toLowerCase()
      : null;

    // Capture aria-labels of visible buttons whose label hints at
    // reactions / engagement — distinguishes "clicked the wrong button"
    // (e.g. clicked a generic "Like" toggle instead of the reactions
    // count summary) from "right button, modal selectors stale".
    // \`offsetHeight > 0\` filters out hidden/offscreen buttons (matches
    // the "visible" promise in the comment AND mirrors the visibility
    // check in the FIND_REACTIONS_SCRIPT below).  Cap length and count
    // to keep the artifact bounded.
    const reactionsButtonAriaLabels = Array.prototype.slice
      .call(document.querySelectorAll('button[aria-label]'))
      .filter(function (el) { return el.offsetHeight > 0; })
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
      dialogCount: legacyDialogs.length,
      dialogHasInLinks: dialogHasInLinks,
      dialogChildElementCount: dialogChildElementCount,
      bodyTextSnippet: (document.body ? document.body.innerText : "").slice(0, 800),
      reactionsButtonAriaLabels: reactionsButtonAriaLabels,
      reactionsCountText: reactionsCountText,
      htmlDialogCount: htmlDialogCount,
      ariaModalCount: ariaModalCount,
      hasReactionsTab: hasReactionsTab,
      reactionsTabAncestorChain: reactionsTabAncestorChain,
      resolvedModalAncestorTag: resolvedModalAncestorTag,
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
