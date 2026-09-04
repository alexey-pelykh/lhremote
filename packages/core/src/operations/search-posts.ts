// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstancePort } from "../cdp/index.js";
import type { FeedPost } from "../types/feed.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import {
  diagnosticCaptureEnabled,
  ensureSecureDiagnosticDir,
  probeVariantDetection,
} from "../cdp/wait-for-post-load.js";
import { assertCardinalCorroboration } from "../linkedin/corroboration.js";
import {
  adaptersFor,
  buildReadinessPredicateSource,
  buildSearchResultsCardFunnelSource,
  buildSearchResultsExtractionSource,
  formatVariantProbes,
  SEARCH_RESULT_CARD_MENU_BUTTON,
  type VariantDetection,
  variantNamesFor,
} from "../linkedin/dom-variant.js";
import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
  ExtractionTimeoutError,
} from "../services/errors.js";
import type { ConnectionOptions } from "./types.js";
import { navigateAwayIf } from "./navigate-away.js";
import { gateOnLoggedInState } from "./wait-for-logged-in-state.js";
import { gaussianDelay, gaussianBetween, maybeHesitate, maybeBreak, simulateReadingTime } from "../utils/delay.js";
import { humanizedScrollToByIndex, retryInteraction } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import {
  type RawDomPost,
  mapRawPosts,
  scrollFeed,
  delay,
} from "./get-feed.js";

/** The page kind this operation reads; picks the adapter list it binds to. */
const SEARCH_RESULTS_SURFACE = "search-results" as const;

/**
 * Input for the search-posts operation.
 */
export interface SearchPostsInput extends ConnectionOptions {
  /** Search query (keywords or hashtag, e.g. `"AI agents"` or `"#AIAgents"`). */
  readonly query: string;
  /** Number of results per page (default: 10). */
  readonly count?: number | undefined;
  /** Index-based cursor (offset) from a previous search-posts call for the next page. */
  readonly cursor?: number | undefined;
  /** Optional humanized mouse for natural cursor movement and scrolling. */
  readonly mouse?: HumanizedMouse | null | undefined;
}

/**
 * Output from the search-posts operation.
 */
export interface SearchPostsOutput {
  /** The search query that was executed. */
  readonly query: string;
  /** List of matching posts. */
  readonly posts: FeedPost[];
  /** Index-based cursor (offset) for retrieving the next page, or null if no more pages. */
  readonly nextCursor: number | null;
}

// ---------------------------------------------------------------------------
// Search-results DOM extraction
// ---------------------------------------------------------------------------

/**
 * One successful scrape of the search-results page.
 *
 * `postCardCount` is the cardinal that corroborates an empty `posts`: the
 * number of enumerated cards that were post-shaped before the control-menu
 * filter ran.  Its exact definition, and why it is the one filter held back,
 * live on {@link buildSearchResultsExtractionSource}.
 */
interface RawSearchResults {
  variant: string;
  postCardCount: number;
  posts: RawDomPost[];
}

/** Two or more adapters claimed the page. */
interface AmbiguousSearchResults {
  ambiguousVariants: string[];
}

function isAmbiguous(
  raw: RawSearchResults | AmbiguousSearchResults,
): raw is AmbiguousSearchResults {
  return Array.isArray((raw as AmbiguousSearchResults).ambiguousVariants);
}

/**
 * JavaScript evaluated inside the LinkedIn search-results page.
 *
 * Generated from the surface's adapter registry, so the dialect is detected on
 * the page being read rather than assumed.  Both registered dialects extract
 * through it; nothing here branches on the variant.
 */
const SCRAPE_SEARCH_RESULTS_SCRIPT = buildSearchResultsExtractionSource(
  adaptersFor(SEARCH_RESULTS_SURFACE),
);

// ---------------------------------------------------------------------------
// Search-results readiness gate
// ---------------------------------------------------------------------------

/**
 * The `cause` a zero-match failure on THIS surface carries.
 *
 * `DOMVariantUnsupportedError`'s own wording asserts one reading — *LinkedIn
 * has changed its markup, register an adapter*.  On post detail that reading
 * is sound, because a post-detail page always has a post: if no adapter claims
 * it, the markup moved.  **This surface does not have that property.**  A
 * search that matched nothing renders no result cards, so no adapter's
 * `detect` anchor can match either, and an operator is sent to write an
 * adapter for a page that is working perfectly.
 *
 * The two states really are indistinguishable *from the DOM* with what is
 * measured today: no live probe of a zero-result search page exists, so there
 * is no measured "empty results" container for either dialect to anchor on.
 * Guessing one would put an unmeasured selector where the registry requires a
 * decisive one — the defect class this whole binding removes.
 *
 * So the cause states what was OBSERVED — no registered adapter's detect
 * anchor matched, with the per-adapter probe counts — and names BOTH readings,
 * rather than leaving the error's own wording to assert the first.
 *
 * Failing loud remains right, and neither half of that is incidental.
 * Returning `posts: []` here would hand a caller an empty result it cannot
 * tell apart from a dialect flip, which is exactly what ADR-008 § Decision 4
 * forbids; and softening the class would lose the one operator action that is
 * right under the first reading.  What was wrong was the diagnosis, not the
 * refusal.  See ADR-008 § 2026-09-02 Amendment (#841) — that date carries two
 * amendments, and this is the search-results one.
 *
 * @param detection - The deadline classification probe's own reading.
 */
function zeroMatchCause(detection: VariantDetection): Error {
  return new Error(
    `detect probes — ${formatVariantProbes(detection)}. ` +
      "No registered adapter's detect anchor matched. That observation has TWO " +
      "readings on the search-results surface and the DOM cannot tell them " +
      "apart: LinkedIn changed its markup (register an adapter for the new " +
      "dialect), OR the search legitimately matched nothing (a result-less " +
      "page renders no cards, so there is no card for any detect anchor to " +
      "match). Confirm the query returns results before writing an adapter.",
  );
}

/**
 * Poll the DOM until the search-results page has rendered *in a dialect an
 * adapter can read*.
 *
 * The predicate is generated from the search-results adapter registry and is
 * satisfied only when exactly one adapter claims the page AND that adapter's
 * own readiness anchor is present — ADR-008 § Decision 1, applied to a second
 * surface.  The predicate it replaced asked only whether any
 * `div[role="listitem"]` held a post control menu, which is variant-agnostic:
 * it went green on a legacy page every scraper selector matched 0 on, which is
 * the whole defect class.
 *
 * **Why zero-match does not raise inside the loop.**  A page that has not
 * hydrated yet also matches zero adapters, so failing fast would be
 * indistinguishable from "LinkedIn changed" and would fire on every slow load.
 * The loop polls first and classifies once, at the deadline, when "not yet"
 * has been ruled out:
 *
 * | Adapters matching at the deadline | Error |
 * |---|---|
 * | zero | {@link DOMVariantUnsupportedError} — see {@link zeroMatchCause} for what that does and does not establish here |
 * | two or more | {@link DOMVariantAmbiguousError} — tighten the detect anchors |
 * | exactly one | {@link ExtractionTimeoutError} — the dialect is known, it never finished rendering |
 *
 * A classification probe that did not run usefully degrades to `null`, which
 * is NOT the claim "no adapter matched": the ordinary timeout is raised rather
 * than blaming LinkedIn for a broken instrument.
 *
 * **This gate is the only path a genuinely empty search takes**, which is why
 * {@link zeroMatchCause} lives here and nowhere else.  A zero-result page
 * renders no cards, so no `detect` anchor matches, so readiness can never go
 * green on one — and the extraction below therefore never sees it.
 *
 * @param client    - Connected CDP client targeting the search-results page.
 * @param timeoutMs - Polling deadline in milliseconds (default: 15s).
 *
 * @throws {@link DOMVariantUnsupportedError} No adapter claimed the page.
 * @throws {@link DOMVariantAmbiguousError} Two or more adapters claimed it.
 * @throws {@link ExtractionTimeoutError} The selected adapter never became ready.
 *
 * @internal Exported for testing.
 */
export async function waitForSearchResults(
  client: CDPClient,
  timeoutMs = 15_000,
): Promise<void> {
  const adapters = adaptersFor(SEARCH_RESULTS_SURFACE);
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

  // captureSearchResultsFailure self-gates on LHREMOTE_CAPTURE_DIAGNOSTICS and
  // swallows its own errors, so every error below propagates unchanged
  // regardless of capture-side outcome.  It fires ahead of the classification
  // rather than per-branch because all three outcomes want the same artifact:
  // a bundle is written whether this ends as unsupported, ambiguous, or a
  // plain timeout (#870).
  //
  // `cardinals: null` — no scrape has run at this point, so there is no
  // `postCardCount` to record.  Stated rather than omitted, for the reason
  // `detection` is: a field that is absent and a field that is empty are
  // different facts.
  await captureSearchResultsFailure(client, {
    trigger: "readiness-timeout",
    detection,
    cardinals: null,
  });

  if (detection) {
    if (detection.matched.length === 0) {
      throw new DOMVariantUnsupportedError(
        SEARCH_RESULTS_SURFACE,
        variantNamesFor(SEARCH_RESULTS_SURFACE).map(String),
        { cause: zeroMatchCause(detection) },
      );
    }
    if (detection.matched.length > 1) {
      throw new DOMVariantAmbiguousError(
        SEARCH_RESULTS_SURFACE,
        detection.matched,
        {
          cause: new Error(`detect probes — ${formatVariantProbes(detection)}`),
        },
      );
    }
  }

  // Exactly one adapter matched (or classification was unavailable): the
  // dialect is known and it genuinely timed out.
  throw new ExtractionTimeoutError(
    `readiness anchor of the selected ${SEARCH_RESULTS_SURFACE} adapter`,
    timeoutMs,
    "Search-results",
  );
}

// ---------------------------------------------------------------------------
// Search-results failure diagnostics (#870)
// ---------------------------------------------------------------------------

/**
 * Cap on the wall-clock time the diagnostic capture BODY is awaited before the
 * caller's error is re-thrown.  Without this, a misbehaving CDP connection
 * could prolong error propagation by up to `CDPClient.send`'s own timeout per
 * call (`Runtime.evaluate` + `Page.captureScreenshot`).
 *
 * Scoped precisely, because the bound is narrower than the whole failure path:
 * it covers {@link captureSearchResultsFailure} only. The `probeVariantDetection`
 * read the two extraction call sites take BEFORE entering it is bounded solely
 * by the client's own request timeout, so a wedged renderer can delay error
 * propagation by that timeout plus this cap. That is inherited from the
 * sibling surfaces rather than introduced here, and it delays the caller's
 * error without ever replacing it — the probe swallows its own failures.
 */
const DIAGNOSTIC_CAPTURE_TIMEOUT_MS = 10_000;

/**
 * Mutable cancellation state shared between the outer wrapper and the inner
 * capture body.  The wrapper flips `timedOut` when the bound timer wins the
 * race; the inner body checks between each async step and returns early,
 * giving up any remaining writes so the process can exit promptly.
 */
interface CaptureCancellationState {
  timedOut: boolean;
}

/**
 * What made a search-results capture fire.
 *
 * Closed rather than a free-form string, for the reason the two sibling
 * surfaces state: these values become filenames operators grep for.
 */
/** @internal Not part of the public API. */
export type SearchResultsFailureTrigger =
  | "readiness-timeout"
  | "extraction-failure";

/**
 * Per-trigger artifact stem, warn-line tag, and warn-line wording.
 *
 * Follows the ADR-007 § 2026-09-01 Amendment table exactly: the timeout row is
 * tagged with the wait function's own name, and the extraction row deliberately
 * is NOT — that gate went green, and labelling the artifact for a timeout that
 * never happened would send the next reader hunting a slow page that was never
 * slow.  Both tags stay single identifier tokens so a log splitter can treat
 * them as one.
 */
const SEARCH_RESULTS_TRIGGER_LABELS: Record<
  SearchResultsFailureTrigger,
  { readonly stem: string; readonly tag: string; readonly summary: string }
> = {
  "readiness-timeout": {
    stem: "wait-for-search-results",
    tag: "waitForSearchResults",
    summary: "timeout diagnostics",
  },
  "extraction-failure": {
    stem: "search-results-extraction-failure",
    tag: "searchResultsExtraction",
    summary: "extraction-failure diagnostics",
  },
};

/**
 * The two halves of the corroboration failure, recorded side by side.
 *
 * This is what makes an `ExtractionFailedError` on THIS surface
 * self-explaining rather than merely typed.  The error prints
 * `postCardCount=N`; the bundle prints it beside the extraction it contradicts
 * and the dialect that produced both, so a reader never has to reconstruct the
 * comparison from an error string and a scrape they cannot see.
 */
/** @internal Not part of the public API. */
export interface SearchResultsCardinals {
  /** The dialect the settled scrape reported for itself. */
  readonly variant: string;
  /**
   * Enumerated cards that were post-shaped — the cardinal the corroborator
   * consulted.  Its exact definition lives on
   * `buildSearchResultsExtractionSource`.
   */
  readonly postCardCount: number;
  /** How many posts that same scrape produced — `posts.length`. */
  readonly extractedCount: number;
}

/**
 * What the caller knows about the failure it is capturing.
 *
 * @internal Not part of the public API.
 */
export interface SearchResultsCaptureContext {
  /** Which failure fired the capture; names the artifact and the warn line. */
  readonly trigger: SearchResultsFailureTrigger;
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
  /**
   * The scrape's own cardinal pair, or `null` when no scrape SETTLED.
   *
   * `null` is stated rather than omitted so it is never confused with a
   * capture that dropped the field, and `trigger` narrows what it means:
   * under `readiness-timeout` no scrape was attempted at all, while under
   * `extraction-failure` it means the scrape came back unreadable — the
   * container-tier refusal, as opposed to the corroboration failure, which
   * always carries the pair because the contradiction IS the pair.
   */
  readonly cardinals: SearchResultsCardinals | null;
}

/**
 * Best-effort diagnostic capture when reading a search-results page fails.
 *
 * **Why this surface has its own capture at all (#870).**  Every other place
 * this codebase can fail to read a LinkedIn page writes a bundle; until this,
 * search results wrote nothing at either failure site.  It is also the surface
 * with the LEAST offline evidence behind it — its `legacy` adapter is
 * reconstructed rather than probed — so a live capture is disproportionately
 * valuable here: it is the only way a field failure yields a page to read.
 *
 * **What the artifact is FOR, specifically.**  ADR-008 § 2026-09-02 Amendment
 * (#841 — that date carries two, and this is the search-results one) records
 * that a zero `detect` match on this surface has TWO readings —
 * LinkedIn changed its markup, or the search legitimately matched nothing —
 * and that they cannot be told apart from the DOM with what is measured today.
 * {@link zeroMatchCause} therefore names both rather than asserting one.  A
 * captured artifact settles which one occurred in a single look, and the two
 * fields that settle it are `bodyTextSnippet` and the screenshot: a
 * result-less search page says so in words a reader can read.
 *
 * That is deliberately NOT a probe.  Adding a `hasNoResultsBlock`-style
 * selector would put an unmeasured anchor into the one artifact an operator
 * consults when they have no other evidence, and a confident wrong reading
 * there is worse than none — the same refusal {@link zeroMatchCause} makes one
 * layer up, for the same reason.  What IS probed is what has been measured:
 * the card-loop layers, and the `[data-testid]` population that measured 0
 * document-wide when LinkedIn reverted to legacy on 2026-08-31.
 *
 * **Two triggers, three call sites.**  `readiness-timeout` fires when the gate
 * times out, ahead of its classification, so all three of its outcomes —
 * unsupported, ambiguous, plain timeout — produce the same artifact.
 * `extraction-failure` fires from the two places in {@link searchPosts} that
 * can fail AFTER that gate went green: the scrape coming back unreadable
 * (`null`, or two adapters claiming the page), and cardinal corroboration
 * raising when `postCardCount > 0` contradicts an empty `posts`.  Neither
 * reaches a deadline — the gate went green in milliseconds — which is why a
 * timeout-gated capture could not see either, and why this surface's dominant
 * suspected failure path produced no artifact at all until #870.
 *
 * That matches both siblings rather than narrowing on them: `getPost` captures
 * on its post-detail scrape's `DOMVariant*` raises and on its corroboration
 * failure, and `getPostEngagers` does the same through its own
 * `unreadableModalError`.
 *
 * Each invocation creates a fresh `${os.tmpdir()}/lhremote-diagnostics-XXXXXX/`
 * directory via `mkdtemp` (atomic; refuses to follow any pre-existing symlink
 * at the prefix) and writes `{trigger-stem}-{timestamp}.json` and a sibling
 * `.png` (full-page `Page.captureScreenshot` with `captureBeyondViewport:
 * true`, when the screenshot succeeds) inside it.  Per-invocation directories
 * prevent concurrent failures from clobbering each other's artifacts AND close
 * the TOCTOU window a shared parent would leave open (ADR-007 § 2026-05-05
 * Amendment).  The trailing `console.warn` reports only the artifacts actually
 * written; the `.png` is best-effort and may be absent.
 *
 * Bundle: `{ trigger, href, title, hasMain, dataTestIdCount, bodyTextSnippet,
 * scopeMatchCounts, candidateCardCount, cardsClearingHeightFloor,
 * cardsWithAuthorLink, cardsWithMenuButton, variantDetection, cardinals }`.
 * The five funnel fields are generated from the adapter registry by
 * `buildSearchResultsCardFunnelSource` and mirror the card loop's own filters
 * in its own order.  The THREE `cards*` counts are CUMULATIVE — read them as a
 * funnel, where the number collapses is the layer that broke.  The other two
 * are not counts of survivors and do not belong to that chain:
 * `scopeMatchCounts` is a per-selector map, and `candidateCardCount` is the
 * deduplicated union it enumerates from, which can exceed what any single
 * adapter would have enumerated.  `variantDetection` is the field the
 * fixed probes structurally cannot supply: read with `matched`, nothing
 * matched means an unknown dialect OR an empty result set on this surface, two
 * or more means a hybrid page, exactly one means that adapter's field
 * selectors went stale.  `null` there means the probe yielded no usable
 * reading, which is NOT the claim that no adapter matched.
 *
 * **Opt-in only.**  Self-gated on `LHREMOTE_CAPTURE_DIAGNOSTICS=1` — no-op
 * otherwise.  Default-off in production (CLI, MCP server) because the
 * artifacts contain LinkedIn page content, i.e. personal data: author names,
 * profile slugs, headlines and post bodies.  E2E tests activate it via
 * `vitest.e2e.config.ts` `env` so every run produces diagnostics without
 * touching the codebase.
 *
 * The diagnostics directory is created with mode `0o700` and files with mode
 * `0o600` (POSIX; no-op on Windows) so that personal data in a shared
 * `os.tmpdir()` is not exposed to other local users.
 *
 * The capture is cooperatively cancellable and bounded by
 * {@link DIAGNOSTIC_CAPTURE_TIMEOUT_MS}: the outer wrapper stops awaiting at
 * the cap, and the inner body checks a shared cancellation flag between each
 * step and returns early when it flips — so remaining CDP calls and disk
 * writes are skipped rather than merely un-awaited.  In rare cases the
 * in-flight async step started before the cap may still complete in the
 * background; the process is not held alive beyond the cap plus any such
 * single in-flight step.
 *
 * Any capture-side failure is swallowed so the caller's original error always
 * propagates unchanged.
 *
 * @param client  - Connected CDP client targeting the failed search page.
 * @param context - Which failure fired the capture, the caller's already-read
 *   `probeVariantDetection` result, and the scrape's cardinal pair if one ran.
 *
 * @internal Exported for unit testing; not part of the public API.
 */
export async function captureSearchResultsFailure(
  client: CDPClient,
  context: SearchResultsCaptureContext,
): Promise<void> {
  if (!diagnosticCaptureEnabled()) return;
  const state: CaptureCancellationState = { timedOut: false };
  let bound: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      // Attach a no-op catch to the inner promise so a late rejection (after
      // the timer wins the race) does not escape as an
      // UnhandledPromiseRejection — capture-side errors must always be
      // swallowed to keep the caller's failure propagating unchanged.
      captureSearchResultsFailureInner(client, context, state).catch(
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

/** The card-funnel probe, generated once from the surface's adapter registry. */
const SEARCH_RESULTS_CARD_FUNNEL_SCRIPT = buildSearchResultsCardFunnelSource(
  adaptersFor(SEARCH_RESULTS_SURFACE),
);

/** What {@link SEARCH_RESULTS_CAPTURE_PROBE_SCRIPT} evaluates to in the page. */
interface SearchResultsCaptureProbe {
  href: string;
  title: string;
  hasMain: boolean;
  dataTestIdCount: number;
  scopeMatchCounts: Record<string, number>;
  candidateCardCount: number;
  cardsClearingHeightFloor: number;
  cardsWithAuthorLink: number;
  cardsWithMenuButton: number;
  bodyTextSnippet: string;
}

/**
 * The whole in-page probe expression, composed once at module load.
 *
 * A named constant rather than a template literal inlined at the evaluate,
 * and the reason is that a hand-written wrapper splicing a generated program
 * into itself is the one part of this capture nothing else can grade.  A
 * syntax error here — a hand-quoted selector, a stray backtick inside one of
 * the comments below, a funnel key colliding with a fixed one under the
 * spread — makes `client.evaluate` reject; the capture's own `.catch` swallows
 * that; and the operator gets no json, no png and no warn line at the one
 * moment they are reading diagnostics.  Naming it lets the Tier-2 oracle
 * evaluate THIS string in a real browser rather than a lookalike it rebuilt,
 * which is the only way that failure is ever observed before a field report.
 *
 * @internal Exported for testing; not part of the public API.
 */
export const SEARCH_RESULTS_CAPTURE_PROBE_SCRIPT = `(() => {
    ${SEARCH_RESULTS_CARD_FUNNEL_SCRIPT}
    return {
      href: location.href,
      title: document.title,
      hasMain: document.querySelector('main') !== null,
      // The measured dialect discriminator, document-wide and deliberately
      // unscoped: [data-testid] matched 0 across the whole document when
      // LinkedIn reverted to legacy on 2026-08-31, so a zero here is the
      // fingerprint of a dialect flip rather than of one stale selector.
      dataTestIdCount: document.querySelectorAll('[data-testid]').length,
      // The two readings of a zero detect match are settled HERE, by a reader,
      // not by a probe — a result-less search page says so in words.  See
      // captureSearchResultsFailure for why no "no results" selector is
      // probed instead.
      bodyTextSnippet: (document.body ? document.body.innerText : "").slice(0, 800),
      // Spread LAST, so a funnel key would win a collision with a fixed field
      // above.  The two sets are disjoint today and the Tier-2 oracle pins
      // that they stay so, by asserting the probe's exact key set.
      ...__lhSearchResultCardFunnel(),
    };
  })()`;

async function captureSearchResultsFailureInner(
  client: CDPClient,
  context: SearchResultsCaptureContext,
  state: CaptureCancellationState,
): Promise<void> {
  const labels = SEARCH_RESULTS_TRIGGER_LABELS[context.trigger];
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  // mkdtemp is the atomic fresh-directory primitive: it generates a random
  // suffix and creates the directory in one syscall, refusing to follow any
  // pre-existing symlink at the prefix.  See `wait-for-post-load.ts`
  // capturePostLoadFailureInner for the full TOCTOU rationale —
  // ensureSecureDiagnosticDir is centralized there; this site reuses it.
  const baseDir = await mkdtemp(join(tmpdir(), "lhremote-diagnostics-"));
  if (state.timedOut) return;
  if (!(await ensureSecureDiagnosticDir(baseDir))) return;
  if (state.timedOut) return;
  const prefix = join(baseDir, `${labels.stem}-${timestamp}`);

  const info = await client.evaluate<SearchResultsCaptureProbe>(
    SEARCH_RESULTS_CAPTURE_PROBE_SCRIPT,
  );
  if (state.timedOut) return;

  // The trigger rides in the bundle as well as in the filename: artifacts get
  // copied out of their mkdtemp directory, and a bundle that cannot say what
  // it was capturing is a bundle whose reader has to guess.
  const bundle = {
    trigger: context.trigger,
    ...info,
    variantDetection: context.detection
      ? {
          matched: context.detection.matched,
          probes: context.detection.probes,
        }
      : null,
    cardinals: context.cardinals,
  };

  // 0o600: owner-only rw.  POSIX-only; no-op on Windows.
  await writeFile(`${prefix}.json`, JSON.stringify(bundle, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  if (state.timedOut) {
    // Cap fired after JSON landed but before screenshot.  Surface the path NOW
    // — the per-invocation mkdtemp directory is the only place these artifacts
    // live, so an early return without a warn would leave operators unable to
    // find them.
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
    // Screenshot is best-effort; the json is the primary artifact.
  }

  // Unconditional warn — even if `state.timedOut` flipped during the
  // screenshot, we still have at least the JSON at the randomized path, and
  // the operator needs the path to find anything at all.  Mention `.png` only
  // when actually written.
  const artifacts = wroteScreenshot ? "{json,png}" : "json";
  console.warn(
    `[${labels.tag}] ${labels.summary} written: ${prefix}.${artifacts}`,
  );
}

/**
 * Write an extraction-failure diagnostic bundle for the search-results page
 * the client is sitting on, then return so the caller can re-throw (#870).
 *
 * The detect probe is skipped when capture is off.  Unlike `getPostEngagers`,
 * nothing on this path needs the probe for the ERROR — the settled scrape
 * already reported its own dialect, and that is what
 * `assertCardinalCorroboration` prints — so the probe's sole consumer is the
 * bundle, and running it on a default-off CLI or MCP run would spend a
 * `Runtime.evaluate` in the page for nobody.  {@link captureSearchResultsFailure}'s
 * own gate fires too late to prevent that, because the probe would already
 * have been evaluated as its argument.
 *
 * Recording BOTH the scrape's self-reported `variant` and a freshly-read
 * `variantDetection` is deliberate: they are two reads at two moments, and the
 * case where they disagree — a page whose dialect changed under the scroll
 * loop — is one a single field could not express.
 *
 * `cardinals` is `null` where the scrape itself was unreadable, so no settled
 * pair exists to record.  On that path the freshly-read `variantDetection` is
 * the whole diagnosis, which is why the probe is worth spending there too.
 *
 * Never throws: `probeVariantDetection` degrades to `null` and
 * {@link captureSearchResultsFailure} swallows its own failures, so the
 * caller's error always propagates unchanged.
 */
async function captureSearchResultsExtractionFailure(
  client: CDPClient,
  cardinals: SearchResultsCardinals | null,
): Promise<void> {
  if (!diagnosticCaptureEnabled()) return;
  const detection = await probeVariantDetection(
    client,
    adaptersFor(SEARCH_RESULTS_SURFACE),
  );
  await captureSearchResultsFailure(client, {
    trigger: "extraction-failure",
    detection,
    cardinals,
  });
}

/**
 * Search LinkedIn for posts matching a keyword query.
 *
 * Connects to the LinkedIn webview in LinkedHelper, navigates to the
 * content search page, and extracts posts from the rendered DOM.
 * Supports keyword search, hashtag search, and cursor-based pagination.
 *
 * @param input - Search query, pagination parameters, and CDP connection options.
 * @returns List of matching posts with cursor for the next page.
 */
export async function searchPosts(
  input: SearchPostsInput,
): Promise<SearchPostsOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const count = input.count ?? 10;
  const cursor = input.cursor ?? null;

  if (!input.query.trim()) {
    throw new Error("Search query must not be empty");
  }

  // Enforce loopback guard
  if (!allowRemote && cdpHost !== "127.0.0.1" && cdpHost !== "localhost") {
    throw new Error(
      `Non-loopback CDP host "${cdpHost}" requires --allow-remote. ` +
        "This is a security measure to prevent remote code execution.",
    );
  }

  await gateOnLoggedInState(cdpPort, cdpHost, allowRemote, { timeout: 60_000 });

  const targets = await discoverTargets(cdpPort, cdpHost);
  const linkedInTarget = targets.find(
    (t) => t.type === "page" && t.url?.includes("linkedin.com"),
  );

  if (!linkedInTarget) {
    throw new Error(
      "No LinkedIn page found in LinkedHelper. " +
        "Ensure LinkedHelper is running with an active LinkedIn session.",
    );
  }

  const client = new CDPClient(cdpPort, { host: cdpHost, allowRemote });
  await client.connect(linkedInTarget.id);

  try {
    // Navigate away if already on the search page to force a fresh load
    await navigateAwayIf(client, "/search/results/");

    // Navigate to LinkedIn content search
    const searchUrl = new URL(
      "https://www.linkedin.com/search/results/content/",
    );
    searchUrl.searchParams.set("keywords", input.query);
    searchUrl.searchParams.set("origin", "GLOBAL_SEARCH_HEADER");
    await client.navigate(searchUrl.toString());

    // Wait for the search results to render
    await waitForSearchResults(client);

    const mouse = input.mouse ?? null;

    // Collect posts — scroll to load more if needed.
    //
    // Cursor is an index-based offset (e.g. "10" means start from post
    // at index 10).  URN-based cursors are not possible because search
    // result posts don't expose URNs in the DOM.
    const maxScrollAttempts = 10;
    let allPosts: RawDomPost[] = [];
    let previousCount = 0;
    // The final scrape's own report of itself.  Seeded rather than left
    // undefined only to satisfy the type checker: the loop below always runs
    // at least once and either assigns both or throws.
    let variant = "unknown";
    let postCardCount = 0;

    const startIdx = cursor ?? 0;
    if (startIdx < 0) {
      throw new Error(`Invalid cursor ${String(cursor)} — must be a non-negative integer offset`);
    }

    for (let scroll = 0; scroll <= maxScrollAttempts; scroll++) {
      const countBeforeScroll = previousCount;
      const scraped = await client.evaluate<
        RawSearchResults | AmbiguousSearchResults | null
      >(SCRAPE_SEARCH_RESULTS_SCRIPT);

      // Both refusals below are this surface's CONTAINER tier, and both are
      // deadline-free failures on a page whose readiness gate went green
      // milliseconds ago — so each captures on the way out rather than at a
      // timeout that will never come.  `cardinals: null`: the scrape is what
      // failed, so there is no settled pair to record.  This mirrors
      // `getPostEngagers`, which captures from its own `unreadableModalError`
      // for exactly these two conditions, and it is the failure the card
      // funnel diagnoses best — an adapter claimed the page moments ago and
      // then enumerated nothing.  Both calls self-gate on
      // LHREMOTE_CAPTURE_DIAGNOSTICS and swallow their own errors, so the
      // raise that follows each is unaffected either way.
      if (!scraped) {
        // Zero adapters claimed the page, or the claiming adapter enumerated
        // no cards.  Either way nothing read the page — and there is no
        // `<main>` left to pretend otherwise with.
        //
        // The error's own "LinkedIn changed its markup" reading IS sound here,
        // and deliberately carries no `zeroMatchCause` qualifier: readiness
        // already went green above, so exactly one adapter's detect anchor
        // matched a card on this page moments ago.  A search that found
        // nothing could never have got this far.
        await captureSearchResultsExtractionFailure(client, null);
        throw new DOMVariantUnsupportedError(
          SEARCH_RESULTS_SURFACE,
          variantNamesFor(SEARCH_RESULTS_SURFACE).map(String),
        );
      }
      if (isAmbiguous(scraped)) {
        // Two or more adapters claimed it.  Refuse rather than pick: a record
        // assembled from two dialects is wrong in a way nothing downstream
        // can detect.
        await captureSearchResultsExtractionFailure(client, null);
        throw new DOMVariantAmbiguousError(
          SEARCH_RESULTS_SURFACE,
          scraped.ambiguousVariants,
        );
      }

      allPosts = scraped.posts;
      variant = scraped.variant;
      postCardCount = scraped.postCardCount;

      const available = allPosts.length - startIdx;
      if (available >= count) break;

      // No new posts appeared after scroll — stop
      if (allPosts.length === previousCount && scroll > 0) break;
      previousCount = allPosts.length;

      // Scroll to load more
      if (scroll < maxScrollAttempts) {
        await scrollFeed(client, mouse);

        // Progressive session fatigue: delays increase with each scroll
        const fatigueMultiplier = 1 + scroll * 0.1;
        // Scale delay by newly visible content volume
        const newPostCount = allPosts.length - countBeforeScroll;
        const contentBonus = Math.min(
          newPostCount * gaussianBetween(350, 75, 200, 500),
          3_000,
        );
        await gaussianDelay(
          1_500 * fatigueMultiplier + contentBonus,
          150 * fatigueMultiplier,
          1_200 * fatigueMultiplier + contentBonus,
          1_800 * fatigueMultiplier + contentBonus,
        );

        // Reading simulation: pause proportional to visible content volume.
        // Estimate ~300 chars per newly visible post (headline + snippet).
        if (newPostCount > 0) {
          await simulateReadingTime(newPostCount * 300);
        }

        await maybeBreak();
      }
    }

    // Corroborate the scrape before trusting an empty one.  `postCardCount`
    // was counted on the very cards this scrape ran over, so the count and
    // the scrape are two halves of one observation, and their disagreeing is
    // a self-contradiction rather than two readings of different things.
    //
    // Both directions are load-bearing, and only one of them is an error:
    // `postCardCount > 0` next to no posts means every card was skipped —
    // under legacy markup that is exactly what an SDUI-only scraper did — and
    // raises; `postCardCount === 0` means the page rendered no post-shaped
    // cards, which is what a search that genuinely found nothing looks like,
    // and returns normally with `posts: []`.
    //
    // Placed AFTER the scroll loop and BEFORE the cursor window is sliced,
    // for two independent reasons.  `scrollFeed` re-scrapes in a loop and an
    // early scrape can legitimately be empty while results are still
    // streaming in, so only the settled scrape is evidence.  And a cursor
    // past the end of a non-empty scrape legitimately yields an empty window,
    // which is a pagination fact about the caller's request rather than an
    // observation about the page.
    try {
      assertCardinalCorroboration({
        surface: SEARCH_RESULTS_SURFACE,
        variant,
        field: "posts",
        cardinalName: "postCardCount",
        cardinal: postCardCount,
        extractedCount: allPosts.length,
      });
    } catch (error) {
      // Capture on the way out (#870).  `assertCardinalCorroboration` is a
      // pure predicate and holds no CDP client, so the capture cannot live
      // inside it — this is the nearest frame that still has the page open,
      // and it is the last one: past this re-throw the `finally` disconnects
      // the client and the DOM that would have explained the failure is gone.
      //
      // Why capture here at all, when the readiness gate already captures:
      // this failure never reaches a deadline.  The gate went green, exactly
      // one adapter claimed the page, cards enumerated — and only then did
      // `postCardCount > 0` come back beside an empty `posts`.  A
      // timeout-gated capture cannot see that, which is why this surface's
      // dominant suspected failure path produced no artifact at all.
      //
      // The funnel in the bundle is what makes it self-explaining: every card
      // filter is shared with the cardinal except the control-menu one, so a
      // funnel reading `cardsWithAuthorLink: 10, cardsWithMenuButton: 0` names
      // the stale selector outright.
      //
      // Swallows its own errors, so `error` propagates unchanged either way.
      await captureSearchResultsExtractionFailure(client, {
        variant,
        postCardCount,
        extractedCount: allPosts.length,
      });
      throw error;
    }

    // --- URL extraction via three-dot menu → "Copy link to post" ---
    // Search result posts don't expose URLs in the DOM.  For each post
    // with urn === null, open the three-dot menu, click "Copy link to
    // post" which writes the URL to the clipboard.
    //
    // Note: URNs are NOT extractable from search results — only the URL
    // is captured here.  Do not attempt to reconstruct URNs from URLs.
    //
    // Electron's clipboard API is broken (readText returns {}) so we
    // monkey-patch navigator.clipboard.writeText to capture into a
    // window global instead.
    const needsUrlExtraction = allPosts.some((p) => p.url === null);
    if (needsUrlExtraction) {
      // Install clipboard interceptor once
      await client.evaluate(
        `navigator.clipboard.writeText = function(text) {
          window.__capturedClipboard = text;
          return Promise.resolve();
        };`,
      );

      // The click target is imported from the shared card skeleton rather than
      // written out again here: it is the same element the readiness gate
      // polls and the card loop filters on, and a third hand-written copy is
      // how one measurement drifts into two.
      //
      // It addresses buttons through the card SKELETON, though, not through
      // the selected adapter's own enumeration root — so the i-th button is
      // the i-th post only as far as the two enumerations agree.  They already
      // disagree wherever a card was skipped (height floor, no author link),
      // which is pre-existing; under a dialect whose cards are not listitems
      // they would not overlap at all and no URL would be read.  Both
      // degradations leave `url: null` on the affected posts rather than a
      // wrong URL, and closing them means a per-card handle the extraction
      // does not return today — a follow-up, not this binding.
      for (let i = 0; i < allPosts.length; i++) {
        const post = allPosts[i];
        if (!post || post.url) continue;

        if (i > 0) await gaussianDelay(550, 125, 300, 800); // Inter-post delay
        await maybeBreak();

        const url = await retryInteraction(async () => {
          await maybeHesitate(); // Probabilistic pause before menu interaction

          // Reset capture
          await client.evaluate(`window.__capturedClipboard = null;`);

          // Scroll the menu button into view (humanized when mouse available)
          await humanizedScrollToByIndex(client, SEARCH_RESULT_CARD_MENU_BUTTON, i, mouse);

          // Click the i-th menu button
          const clicked = await client.evaluate<boolean>(`(() => {
            const btns = document.querySelectorAll(
              ${JSON.stringify(SEARCH_RESULT_CARD_MENU_BUTTON)}
            );
            const btn = btns[${String(i)}];
            if (!btn) return false;
            btn.click();
            return true;
          })()`);
          if (!clicked) return null;

          await gaussianDelay(700, 100, 500, 900);

          // Click "Copy link to post" menu item
          await client.evaluate(`(() => {
            for (const el of document.querySelectorAll('[role="menuitem"]')) {
              if (el.textContent.trim() === 'Copy link to post') {
                el.click();
                return;
              }
            }
          })()`);

          await gaussianDelay(550, 75, 400, 700);

          // Read captured URL
          return client.evaluate<string | null>(`window.__capturedClipboard`);
        });

        if (url) {
          post.url = url.split("?")[0] ?? url;
        }
      }
    }

    // Slice the result window
    const window = allPosts.slice(startIdx, startIdx + count);
    const posts = mapRawPosts(window);

    // Determine next cursor (index-based offset)
    const hasMore = startIdx + count < allPosts.length;
    const nextCursor = hasMore ? startIdx + count : null;

    await gaussianDelay(800, 300, 300, 1_800); // Post-action dwell
    return { query: input.query, posts, nextCursor };
  } finally {
    client.disconnect();
  }
}
