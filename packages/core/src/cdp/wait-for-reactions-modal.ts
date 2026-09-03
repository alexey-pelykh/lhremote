// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adaptersFor,
  buildReadinessPredicateSource,
  formatVariantProbes,
  type VariantDetection,
  variantNamesFor,
} from "../linkedin/dom-variant.js";
import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
  ExtractionTimeoutError,
} from "../services/errors.js";
import { delay } from "../utils/delay.js";
import { jsString } from "../utils/js-string.js";
import type { CDPClient } from "./client.js";
import {
  diagnosticCaptureEnabled,
  ensureSecureDiagnosticDir,
  probeVariantDetection,
} from "./wait-for-post-load.js";

/** The page kind this gate reads; picks the adapter list it binds to. */
const REACTIONS_MODAL_SURFACE = "reactions-modal" as const;

// ----------------------------------------------------------------------------
// Diagnostic-only selectors ({@link captureReactionsModalFailure}).
//
// These no longer feed the readiness predicate or any script in
// `get-post-engagers.ts`.  Since #840 the reactions modal is a registered
// surface, so the predicate is generated from its adapter list and polls the
// SELECTED adapter's own anchor, and the scrape / scroll / total scripts
// resolve the modal through that same registry.
//
// They stay because a failure still wants a "which-of-N-is-missing" picture
// across every wrapper shape LinkedIn has served, and that picture is
// deliberately WIDER than any single adapter's binding — it is the artifact a
// reader consults precisely when no adapter could read the page, which is the
// one moment an adapter-bound probe has nothing to say.
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
 * precedence.
 *
 * **Diagnostic-only since #840, and WIDER than either adapter — deliberately.**
 * The first two entries are the `sdui` reactions-modal adapter's own `scopes`.
 * The third, `[role="dialog"]`, belongs to NEITHER adapter: `legacy`'s scopes
 * are its two `social-details-reactors-modal` anchors.  The 2026-09-02 probe
 * did record `[role="dialog"]` matching 1 on the legacy modal — it sits on the
 * same measured wrapper element — but it was rejected as an ADAPTER anchor for
 * being generic: it describes *a* modal rather than *this* one and matched 1
 * only because that was the one dialog open, so binding to it would resolve an
 * unrelated overlay on a page where the reactors modal is absent (see
 * `dom-variant.ts`, {@link LEGACY_REACTORS_MODAL}).  It survives HERE precisely
 * because a diagnostic wants to report every wrapper shape LinkedIn has ever
 * served, including ones no adapter is willing to bind to.  Do not "restore"
 * it to the legacy adapter's `scopes` on the strength of this list — that is
 * the #773 over-match.
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
 * `<a href="/in/{slug}">` linking to that person's profile.  Diagnostic-only
 * since #840, where it feeds `dialogHasInLinks` and the ancestor chain.
 *
 * It is deliberately no longer what readiness polls.  "At least one engager
 * link is present" cannot go green on a modal that legitimately holds nobody,
 * so it made a genuinely-zero post indistinguishable from a timeout — the very
 * distinction the container tier now draws (ADR-008 § Decision 4).
 */
const REACTIONS_MODAL_ENGAGER_LINK_SELECTOR = 'a[href*="/in/"]';

// Both selectors above are interpolated into emitted JavaScript through
// {@link jsString}, never by hand-quoting them as `'${CONST}'`.  Both contain
// double quotes today, so hand-quoting happened to work; the moment either
// grows a single quote or a backslash it would emit a syntax error or, worse,
// a valid-but-different selector.  The failure would be invisible: the
// capture's own `.catch` swallows an evaluate that throws, so the operator
// gets no json, no png and no warn line at the one moment diagnostics matter.
//
// The rule used to be restated here as a bare `JSON.stringify` per site, which
// is the same primitive but leaves each new site re-deciding it.  It is now the
// shared helper every module building in-page source calls, so the question at
// a site is the greppable "does this go through `jsString`?" rather than the
// unaskable "is this quoting correct?".
//
// {@link REACTIONS_MODAL_WRAPPER_SELECTORS} is deliberately NOT one of these:
// it is interpolated whole, as an in-page *array* literal, which is a different
// emission — see the resolver script below.

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
 * `Element` or `null`.
 *
 * **Diagnostic-only since #840, and no longer exported.**  Its two stages did
 * not disappear — they were split along the axis they always had.  Stage 1's
 * wrapper list and stage 2's ancestor walk are now the reactions-modal
 * adapters' `scopes` and `extract` respectively, per dialect, so the operation
 * resolves the modal through the registry and knows WHICH dialect answered.
 * What is left here is the union of both stages, which is what a diagnostic
 * wants: it reports whether ANY known wrapper shape is on the page, including
 * on a page no registered adapter claims.
 */
const RESOLVE_REACTIONS_MODAL_SCRIPT = `
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
        c.querySelector(${jsString(REACTIONS_TAB_FALLBACK_SELECTOR)}) ||
        c.querySelector(${jsString(REACTIONS_MODAL_ENGAGER_LINK_SELECTOR)})
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
  const tab = document.querySelector(${jsString(REACTIONS_TAB_FALLBACK_SELECTOR)});
  if (!tab || tab.offsetHeight === 0) return null;
  let ancestor = tab.parentElement;
  let depth = 0;
  while (ancestor && depth < ${REACTIONS_MODAL_ANCESTOR_WALK_DEPTH}) {
    if (ancestor.querySelectorAll(${jsString(REACTIONS_MODAL_ENGAGER_LINK_SELECTOR)}).length > 0) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
    depth++;
  }
  return null;
}
`;

/**
 * Poll the DOM until the reactions modal has rendered *in a dialect an adapter
 * can read*.
 *
 * The predicate is generated from the reactions-modal adapter registry
 * ({@link buildReadinessPredicateSource}) and is satisfied only when exactly
 * one adapter claims the page AND that adapter's own readiness anchor is
 * present — ADR-008 § Decision 1, applied to a third surface.  The `detect`
 * half is the post page's reactions TRIGGER, which is still there after the
 * click, so the conjunction stays meaningful once the modal is open; the
 * `ready` half is a container-tier anchor of the modal itself.
 *
 * **What changed, and why it is not a weakening (#840).**  The predicate this
 * replaces asked whether at least one engager profile link had appeared inside
 * a resolved modal.  That is a *row*-tier question, and it cannot go green on
 * a modal that legitimately holds nobody — so a post with zero reactions timed
 * out here, on a modal that had opened perfectly.  Readiness now stops at the
 * container tier and the cardinal tier decides what an empty list means, which
 * is the split ADR-008 § Decision 4 draws and the reason this surface was
 * registered at all.  Nothing about the #773 wrapper problem is lost: both
 * stages of that resolver are now per-dialect adapter fields.
 *
 * **Why zero-match does not raise inside the loop.**  A modal that has not
 * rendered yet also matches zero adapters, so failing fast would be
 * indistinguishable from "LinkedIn changed" and would fire on every slow open.
 * The loop polls first and classifies once, at the deadline:
 *
 * | Adapters matching at the deadline | Error |
 * |---|---|
 * | zero | {@link DOMVariantUnsupportedError} — register an adapter |
 * | two or more | {@link DOMVariantAmbiguousError} — tighten the detect anchors |
 * | exactly one | {@link ExtractionTimeoutError} — the dialect is known, the modal never rendered |
 *
 * A classification probe that did not run usefully degrades to `null`, which
 * is NOT the claim "no adapter matched": the ordinary timeout is raised rather
 * than blaming LinkedIn for a broken instrument.
 *
 * Unlike the search-results gate, a zero match here needs no "or the page is
 * legitimately empty" qualifier.  A post with no reactions never reaches this
 * function: its trigger is what the caller failed to find, and that path
 * returns an empty list without opening anything.
 *
 * On failure, if `LHREMOTE_CAPTURE_DIAGNOSTICS=1`, a best-effort diagnostic
 * capture is written to a per-invocation
 * `${os.tmpdir()}/lhremote-diagnostics-XXXXXX/` directory before the error
 * propagates; see {@link captureReactionsModalFailure}.  Opt-in because the
 * LinkedIn engager modal can include personal data (engager names, profile
 * slugs, headlines).
 *
 * @param client    - Connected CDP client targeting a LinkedIn page.
 * @param timeoutMs - Polling deadline in milliseconds (default: 10s).
 *
 * @throws {@link DOMVariantUnsupportedError} No adapter claimed the page.
 * @throws {@link DOMVariantAmbiguousError} Two or more adapters claimed it.
 * @throws {@link ExtractionTimeoutError} The selected adapter never became ready.
 */
export async function waitForReactionsModal(
  client: CDPClient,
  timeoutMs = 10_000,
): Promise<void> {
  const adapters = adaptersFor(REACTIONS_MODAL_SURFACE);
  const predicate = buildReadinessPredicateSource(adapters);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate<boolean>(predicate);
    if (ready) return;
    await delay(500);
  }

  // Classify what the page actually is before reporting.  One probe, on the
  // failure path only — the happy path pays nothing for it.  The same read
  // feeds both the error's `cause` and the diagnostic bundle below, so the two
  // can never disagree about what was on the page.
  const detection = await probeVariantDetection(client, adapters);

  // captureReactionsModalFailure self-gates on LHREMOTE_CAPTURE_DIAGNOSTICS
  // and swallows its own errors, so the error below always propagates
  // unchanged regardless of capture-side outcome.
  await captureReactionsModalFailure(client, {
    trigger: "readiness-timeout",
    detection,
  });

  if (detection) {
    if (detection.matched.length === 0) {
      throw new DOMVariantUnsupportedError(
        REACTIONS_MODAL_SURFACE,
        variantNamesFor(REACTIONS_MODAL_SURFACE).map(String),
        {
          cause: new Error(`detect probes — ${formatVariantProbes(detection)}`),
        },
      );
    }
    if (detection.matched.length > 1) {
      throw new DOMVariantAmbiguousError(
        REACTIONS_MODAL_SURFACE,
        detection.matched,
        {
          cause: new Error(`detect probes — ${formatVariantProbes(detection)}`),
        },
      );
    }
  }

  // Exactly one adapter matched (or classification was unavailable): the
  // dialect is known and the modal genuinely never rendered.
  throw new ExtractionTimeoutError(
    `readiness anchor of the selected ${REACTIONS_MODAL_SURFACE} adapter`,
    timeoutMs,
    "Reactions-modal",
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
 * What made a reactions-modal capture fire.
 *
 * The capture used to have exactly one trigger, so "timeout" could be baked
 * into the filename and the warn line.  Since #835 it also fires when the
 * engager scrape contradicts itself — the modal header reporting N reactions
 * while the list yields none — a failure decided in milliseconds that never
 * reaches a deadline.  The trigger travels with the call so a bundle is never
 * labelled for a timeout that did not happen.
 *
 * The vocabulary is deliberately closed rather than a free-form string: these
 * values become filenames operators grep for.
 */
/** @internal Not part of the public API. */
export type ReactionsModalFailureTrigger =
  | "readiness-timeout"
  | "extraction-failure";

/**
 * Per-trigger artifact stem, warn-line tag, and warn-line wording.
 *
 * The `readiness-timeout` row reproduces the pre-#835 strings exactly — that
 * capture's behaviour is unchanged.  Only the new trigger gets new words.
 */
const REACTIONS_MODAL_TRIGGER_LABELS: Record<
  ReactionsModalFailureTrigger,
  { readonly stem: string; readonly tag: string; readonly summary: string }
> = {
  "readiness-timeout": {
    stem: "wait-for-reactions-modal",
    tag: "waitForReactionsModal",
    summary: "timeout diagnostics",
  },
  "extraction-failure": {
    stem: "reactions-modal-extraction-failure",
    // Not `waitForReactionsModal`: that gate went green — the modal opened
    // and rendered engager links.  What failed is the row scrape inside it.
    // Identifier-shaped like the family's other tags so a log splitter can
    // still treat the tag as one token.
    tag: "reactionsModalExtraction",
    summary: "extraction-failure diagnostics",
  },
};

/**
 * What the caller knows about the failure it is capturing.
 *
 * @internal Not part of the public API.
 */
export interface ReactionsModalCaptureContext {
  /** Which failure fired the capture; names the artifact and the warn line. */
  readonly trigger: ReactionsModalFailureTrigger;
  /**
   * Per-registered-adapter detect counts, already read by the caller via
   * `probeVariantDetection`, recorded verbatim in the bundle.
   *
   * Required rather than optional, and `null`-able rather than omittable: the
   * caller is the only party that knows whether a probe was even attempted,
   * and a bundle silently missing the field would be indistinguishable from
   * one where the probe returned nothing.  `null` records the honest answer —
   * *no usable reading* — which is NOT the claim "no adapter matched".
   */
  readonly detection: VariantDetection | null;
}

/**
 * Best-effort diagnostic capture when reading the reactions modal fails.
 *
 * **Two triggers, not one** ({@link ReactionsModalFailureTrigger}, #835):
 * {@link waitForReactionsModal} timing out waiting for the modal DOM, and an
 * engager scrape that got past that gate contradicting itself
 * (`assertCardinalCorroboration`).  The second never reaches a deadline, so a
 * timeout-gated capture could not see it at all.
 *
 * **This bundle now carries per-adapter detect counts (#840), and the sentence
 * that used to stand here saying it could not is corrected rather than
 * deleted.**  It said the reactions modal has no entry in the variant-adapter
 * registry and that whether it even has a container tier was unprobed (#830).
 * Both halves have since been answered: the spike measured a container tier on
 * the legacy modal, and the surface is registered, so `variantDetection` is a
 * real reading rather than the fabricated field that reasoning correctly
 * refused to invent.  Read it together with `matched`, which decides between
 * the three cases the detection source distinguishes: nothing matched (a
 * dialect nobody registered), two or more (a hybrid page — tighten the detect
 * anchors), exactly one (the dialect is known, so repair that adapter's
 * selectors).  `null` records that the probe yielded no usable reading, which
 * is NOT the claim "no adapter matched".
 *
 * Each invocation
 * creates a fresh `${os.tmpdir()}/lhremote-diagnostics-XXXXXX/`
 * directory via `mkdtemp` (atomic; refuses to follow any pre-existing
 * symlink at the prefix) and writes
 * `{trigger-stem}-{timestamp}.json` (trigger, URL, dialog probes,
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
 * Any capture-side failure is swallowed so the caller's original error
 * always propagates unchanged.
 *
 * Probe set: `{ trigger, href, dialogCount, dialogHasInLinks,
 * dialogChildElementCount, bodyTextSnippet, reactionsButtonAriaLabels,
 * reactionsCountText, htmlDialogCount, ariaModalCount, hasReactionsTab,
 * reactionsTabAncestorChain, resolvedModalAncestorTag, variantDetection }` —
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
 * @internal Exported for unit testing and for the operation-layer
 *   extraction-failure site; not part of the public API.
 */
export async function captureReactionsModalFailure(
  client: CDPClient,
  context: ReactionsModalCaptureContext,
): Promise<void> {
  if (!diagnosticCaptureEnabled()) return;
  const state: CaptureCancellationState = { timedOut: false };
  let bound: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      // Attach a no-op catch to the inner promise so a late rejection
      // (after the timer wins the race) does not escape as an
      // UnhandledPromiseRejection — capture-side errors must always be
      // swallowed to keep the caller's failure propagating unchanged.
      captureReactionsModalFailureInner(client, context, state).catch(
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        bound = setTimeout(() => {
          state.timedOut = true;
          resolve();
        }, DIAGNOSTIC_CAPTURE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Capture itself failed; do not mask the caller's error.
  } finally {
    if (bound !== undefined) clearTimeout(bound);
  }
}

async function captureReactionsModalFailureInner(
  client: CDPClient,
  context: ReactionsModalCaptureContext,
  state: CaptureCancellationState,
): Promise<void> {
  const labels = REACTIONS_MODAL_TRIGGER_LABELS[context.trigger];
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
  const prefix = join(baseDir, `${labels.stem}-${timestamp}`);

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
      ? firstLegacyDialog.querySelectorAll(${jsString(REACTIONS_MODAL_ENGAGER_LINK_SELECTOR)}).length > 0
      : false;
    const dialogChildElementCount = firstLegacyDialog ? firstLegacyDialog.childElementCount : 0;

    // New wrapper-shape probes — distinguish "modal not opened at all"
    // from "modal opened but uses a different wrapper element".  If any
    // of these are non-zero / true while \`dialogCount === 0\`, the
    // resolver fallback in RESOLVE_REACTIONS_MODAL_SCRIPT must adapt.
    const htmlDialogCount = document.querySelectorAll('dialog').length;
    const ariaModalCount = document.querySelectorAll('[aria-modal="true"]').length;
    const reactionsTab = document.querySelector(${jsString(REACTIONS_TAB_FALLBACK_SELECTOR)});
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
        const inLinks = ancestor.querySelectorAll(${jsString(REACTIONS_MODAL_ENGAGER_LINK_SELECTOR)}).length;
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

    // The text the SUPERSEDED text-only finder would have matched, kept
    // deliberately (#840).  Read beside reactionsButtonAriaLabels, a null
    // here next to a label reading "<N> reactions" IS the fingerprint of the
    // defect that finder had: legacy renders the count as a bare number and
    // puts the words only on the control, so a text-only match saw nothing on
    // a post that had reactions.  The live rule reads the label first; this
    // probe is what shows a reader which of the two the page supports.
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
  // The trigger rides in the bundle as well as in the filename: artifacts get
  // copied out of their mkdtemp directory, and a bundle that cannot say what
  // it was capturing is a bundle whose reader has to guess (#835).
  //
  // `variantDetection` is the field the fixed probes above structurally cannot
  // supply: every one of them is a hard-coded selector, so a modal served in a
  // dialect nobody registered looks exactly like one whose registered adapter
  // matched but whose anchors went stale (#840).
  const bundle = {
    trigger: context.trigger,
    ...info,
    variantDetection: context.detection,
  };

  await writeFile(`${prefix}.json`, JSON.stringify(bundle, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  if (state.timedOut) {
    // Cap fired after JSON landed but before screenshot.  Surface the
    // path NOW — the per-invocation mkdtemp directory is the only
    // place these artifacts live, so an early return without a warn
    // would leave operators unable to find them.
    console.warn(
      `[${labels.tag}] ${labels.summary} partial: ${prefix}.json (screenshot skipped — capture cap reached)`,
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
    `[${labels.tag}] ${labels.summary} written: ${prefix}.${artifacts}`,
  );
}
