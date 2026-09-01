// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * DOM variant adapters: which markup dialect LinkedIn is serving for a
 * surface, detected per page at runtime.
 *
 * ## Why this exists
 *
 * LinkedIn does not serve one stable markup dialect per surface.  It served
 * a React + CSS-Modules + SDUI stack for post detail from 2026-05-06, and by
 * 2026-08-31 was serving the pre-SDUI legacy markup again on the same URLs.
 * The drift is **non-monotonic** — forward, then backward — and may be a
 * per-session A/B bucket.  So the dialect cannot be a build constant, a
 * config flag, an env var, or a dated migration: it has to be **detected on
 * the page being read**.
 *
 * ## The two axes
 *
 * `selectors.ts` already documents a two-stack world, but on the **surface**
 * axis: feed page vs post page.  This module models the orthogonal
 * **temporal** axis: which dialect that surface is speaking right now.  A
 * {@link VariantAdapter} is keyed on the *pair* — `(Surface, DOMVariant)`.
 *
 * ## Why not a selector union
 *
 * The obvious cheap fix is to widen the comma-separated selector unions in
 * `selectors.ts` until they match both dialects.  A union cannot report
 * *which* dialect it matched, so it can build one record out of two dialects
 * with no way to notice.  Per-field fallback ("try selectors until one
 * yields non-empty") is worse: it makes *empty* indistinguishable from
 * *failed*, which is the exact defect this module exists to remove.
 *
 * ## No terminal fallback
 *
 * Selection has exactly three outcomes and none of them is a default:
 *
 * - exactly one adapter's detect anchor matches -> that adapter is selected
 * - zero match -> `DOMVariantUnsupportedError`; **there is no `<main>` to
 *   fall back to**, because the cascade has been replaced by a registry
 *   lookup that can legitimately return nothing
 * - two or more match -> `DOMVariantAmbiguousError`; a transitional or
 *   hybrid page, where picking one would silently blend two dialects
 *
 * ## Extending
 *
 * Registering a third dialect means appending one {@link VariantAdapter} to
 * the surface's array below.  Nothing at a call site branches on the variant
 * — detection, readiness and extraction are all *generated* from the array
 * by the `build*Source` functions — so no control flow changes.
 */

/**
 * The markup dialect a surface is speaking.
 *
 * Deliberately an **open set**, not a boolean and not a closed union: the
 * next dialect is unknown and unschedulable, and a closed union would force
 * a type change (and therefore a call-site change) to admit it.  The known
 * members are listed in {@link KNOWN_DOM_VARIANTS} for discoverability while
 * any other string stays assignable.
 */
export type DOMVariant = (typeof KNOWN_DOM_VARIANTS)[number] | (string & {});

/**
 * The dialects with a registered adapter today.  Informational: this is not
 * the type's domain, and a new dialect does not have to be added here before
 * it can be registered.
 */
export const KNOWN_DOM_VARIANTS = ["sdui", "legacy"] as const;

/**
 * A LinkedIn page kind being read.  Each surface owns its own adapter list,
 * because the same dialect renders different surfaces differently.
 */
export type Surface = "post-detail";

/**
 * One dialect's binding for one surface.
 *
 * The four anchors are not interchangeable and the distinction is the point
 * of the whole module:
 *
 * - {@link detect} answers *"is this dialect present?"* and must be decisive
 *   — it is what makes the selection unambiguous.
 * - {@link ready} answers *"has this dialect finished rendering?"*.  It MUST
 *   belong to this adapter.  A gate anchored on something that survives
 *   every markup change cannot detect a markup change: the anchor previously
 *   used here matched 85 elements on a page where every scraper selector
 *   matched 0, so the gate went green on a page the scrapers could not read.
 * - {@link scopes} are the extraction root, tried in order, all within this
 *   one dialect.  Ordering inside a dialect is a precision choice (tightest
 *   container first); it is not a cross-dialect cascade and it has no
 *   always-true terminal member.
 * - {@link extract} is the field extraction for this dialect.
 */
export interface VariantAdapter {
  /** The surface this adapter reads. */
  readonly surface: Surface;
  /** The dialect this adapter speaks. */
  readonly variant: DOMVariant;
  /**
   * Decisive CSS anchor proving THIS dialect is present.
   *
   * Chosen to be exclusive: it must not match on a sibling adapter's
   * dialect, or selection reports ambiguity on a page that is not actually
   * hybrid.
   */
  readonly detect: string;
  /**
   * Readiness CSS anchor belonging to THIS adapter — what the gate polls
   * once this adapter is selected.
   */
  readonly ready: string;
  /**
   * Extraction root candidates, in order of decreasing precision.  All
   * belong to this dialect.  If none matches, this adapter yields nothing;
   * it does not widen to `<main>` or `document`.
   */
  readonly scopes: readonly string[];
  /**
   * Narrowing candidates for the engagement-counts row, tried in order
   * *within* the resolved scope.  When none matches — including the
   * deliberately empty list of a dialect whose counts row has never been
   * measured — the scope itself is the counts root.
   *
   * That fallback is not the terminal fallback this module forbids.  The one
   * it forbids widens to something that matches on EVERY page (`<main>`,
   * `document`) and so makes an unreadable page look readable.  This one
   * lands on an anchor that is already dialect-bound and already resolved:
   * it can cost precision, never a false claim to have read the page.
   *
   * What bounds that cost is how a counter is read.  Every candidate is
   * matched against ONE element's own text, anchored end to end, so a run
   * found inside a longer one is not a counter.  An ancestor can still
   * satisfy the anchored pattern by concatenation — "2" beside "41 comments"
   * flattens to exactly "241 comments" — so anchoring alone is not the
   * guard; the deepest hit of the first containment chain wins, which picks
   * the element that RENDERS a counter over the ancestor that merely runs it
   * together with its neighbour.  See `__lhReadCount`.
   */
  readonly counts: readonly string[];
  /**
   * In-page JavaScript **function source** of the form
   * `(function (scope) { ...; return {...}; })`, evaluated with the resolved
   * scope element.  It returns the raw post-detail field bag.
   *
   * Evaluated inside the extraction script, so the shared text helpers
   * {@link extractionHelpersSource} emits — `__lhVisibleText`,
   * `__lhCleanName`, `__lhFirstHeadline` — are in scope and may be called.
   * They are shared rather than copied into each dialect because what differs
   * between dialects there is *where* a string is rendered, not how a rendered
   * string is read.
   *
   * Source rather than a structured selector bag because the dialects differ
   * in extraction *algorithm*, not merely in selector strings — SDUI reads a
   * `data-testid` leaf, legacy reads the longest `span[dir="ltr"]`.  Forcing
   * both into one parameterised shape would either lose one dialect's logic
   * or grow a per-dialect branch, which is what keying on the pair avoids.
   */
  readonly extract: string;
}

// ---------------------------------------------------------------------------
// post-detail :: sdui
// ---------------------------------------------------------------------------

/**
 * Post-detail extraction for the React/SDUI dialect LinkedIn served from
 * 2026-05-06.
 *
 * Carried over verbatim from the `SCRAPE_POST_DETAIL_SCRIPT` body that
 * shipped in `get-post.ts` (lhremote#800), minus the scope cascade, which is
 * now {@link VariantAdapter.scopes}.  Verified across all four post types
 * (regular / share / ugcPost / self) by the #800 spike; see
 * `research/linkedin/post-detail-body-dom-react-sdui-20260507.md`.
 *
 * The `replaceableComment_` exclusions are retained.  They were originally
 * defence-in-depth against the `<main>` fallback dragging the comment list
 * into scope; that fallback is gone, but the SDUI *screen* scope (the second
 * entry in `scopes`) still contains the comment list as a descendant, so the
 * exclusions remain load-bearing for that scope.
 */
const SDUI_POST_DETAIL_EXTRACT = `(function (scope) {
  var authorName = null;
  var authorHeadline = null;
  var authorProfileUrl = null;
  var text = null;
  var timestamp = null;

  // --- Author info ---
  // The post-author has 3 anchors inside scope: avatar (text empty),
  // name link ("<Name>  • <degree>"), and a height-zero "extended click
  // area".  All point to the same /in/{publicId}/.  Use the first
  // anchor for the URL; find the first anchor with non-empty text for
  // the display name.
  //
  // Skip anchors that sit inside any [componentkey^="replaceableComment_"]
  // subtree so a commenter never gets picked as the post author.
  var authorLink = null;
  for (const a of scope.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')) {
    if (a.closest('[componentkey^="replaceableComment_"]')) continue;
    authorLink = a;
    break;
  }
  if (authorLink) {
    authorProfileUrl = (authorLink.href || '').split('?')[0] || null;

    // Find a sibling anchor with the same href but non-empty text.  Iterate
    // and compare attribute values directly rather than building a CSS
    // attribute selector via concatenation — the latter throws on hrefs
    // containing CSS-special characters (quotes, backslashes), and the raw
    // attribute can include LinkedIn-injected query strings.
    const targetHref = authorLink.getAttribute('href');
    let nameAnchor = null;
    for (const a of scope.querySelectorAll('a')) {
      if (a.getAttribute('href') !== targetHref) continue;
      if ((a.textContent || '').trim().length > 0) { nameAnchor = a; break; }
    }

    // Read the copy a reader sees, then drop the decorations LinkedIn renders
    // beside it — the " • <degree>" suffix ("<Name>  • 1st" / " • You") and a
    // Premium / Verified profile badge.  Both are handled by the shared
    // helpers so the two dialects cannot drift apart on them.
    authorName = __lhCleanName(__lhVisibleText(nameAnchor));
  }

  // --- Author headline ---
  // After the author block, there's a headline element in <p> or <span>
  // form.  Scan the post container for the first candidate the shared
  // headline rule accepts, skipping the comment list: the SDUI *screen*
  // scope contains it as a descendant, so a commenter's headline is
  // otherwise reachable from here.
  const headlineCandidates = [];
  for (const el of scope.querySelectorAll('p, span')) {
    if (el.closest('[componentkey^="replaceableComment_"]')) continue;
    headlineCandidates.push(el);
  }
  authorHeadline = __lhFirstHeadline(headlineCandidates, authorName);

  // --- Post text ---
  // Cascade per research: data-testid leaf -> componentkey wrapper.
  // Both selectors are stable and verified across all 4 post types
  // (regular / share / ugcPost / self).  Very short posts may have
  // neither — accept null in that case rather than synthesizing.
  let textEl = scope.querySelector('[data-testid="expandable-text-box"]');
  if (!textEl) {
    textEl = scope.querySelector('[componentkey^="feed-commentary_"]');
  }
  if (textEl) {
    const t = (textEl.textContent || '').trim();
    if (t.length > 0) text = t;
  }

  // --- Timestamp ---
  // The SDUI post-detail page has NO <time> element inside the post
  // container (verified across all 4 post types).  Extract the
  // relative-time prefix from container textContent: "<degree>2w •",
  // "<degree>1mo •", etc.  "Edited" is a status flag, not a timestamp,
  // so it is intentionally excluded from the alternation.
  const scopeText = scope.textContent || '';
  const timeMatch = scopeText.match(/(?:1st|2nd|3rd|You)(\\d+[smhdw]|[1-9]\\d*mo)\\s+•/) ||
                     scopeText.match(/(?:^|\\s)(\\d+[smhdw]|[1-9]\\d*mo)\\s+•/);
  if (timeMatch) timestamp = timeMatch[1];

  return { authorName, authorHeadline, authorProfileUrl, text, timestamp };
})`;

/** Post-detail container componentkey — the tightest SDUI scope. */
const SDUI_CONTAINER =
  '[componentkey^="expanded"][componentkey$="FeedType_FEED_DETAIL"]';

/**
 * SDUI screen wrapper — the wider SDUI scope, used when the container prefix
 * changes.  It includes the comment list as a descendant, which is why the
 * extractor's `replaceableComment_` exclusions are load-bearing.
 */
const SDUI_SCREEN =
  '[data-sdui-screen="com.linkedin.sdui.flagshipnav.feed.UpdateDetail"]';

/** `<scope> a[href*="/in/"], <scope> a[href*="/company/"]` for each scope. */
function authorLinkWithin(scopes: readonly string[]): string {
  return scopes
    .flatMap((scope) => [
      `${scope} a[href*="/in/"]`,
      `${scope} a[href*="/company/"]`,
    ])
    .join(", ");
}

/**
 * SDUI post-detail adapter.
 *
 * `detect` spans BOTH SDUI roots, and that matters: if it were only the
 * container, the screen entry in `scopes` would be unreachable — selection
 * requires the container to be present, so the scope loop would always
 * resolve on its first candidate and the documented fallback would be dead
 * code justified by a comment. Covering both keeps the fallback live, which
 * is the tolerance the pre-registry cascade had for the `expanded` prefix
 * being renamed. Both anchors are SDUI-only (`componentkey` and
 * `data-sdui-screen`), so widening within the dialect cannot collide with
 * the legacy adapter.
 *
 * `ready` is the author link inside whichever of those roots is present.
 * Two things are going on and both matter. It is the old gate's author-link
 * stage re-scoped from `<main>` to this adapter's own roots, which is the
 * whole ADR-008 binding: the same anchor was variant-agnostic under `<main>`
 * and is variant-specific under an SDUI root. And it is deliberately
 * *stricter* than the root alone — a container can be present in a skeleton
 * state before the post body hydrates, so gating on it would let extraction
 * run against an empty container and hand back an empty record, which is the
 * failure mode being removed rather than a new one.
 *
 * `counts` is deliberately EMPTY: no engagement-counts row has been measured
 * for this dialect, and guessing one would either match nothing (silently
 * zeroing every count) or match something that is not the counts row.  The
 * read therefore falls back to this adapter's own resolved scope, which the
 * anchored per-element matching makes safe — see {@link VariantAdapter.counts}.
 * The one thing the dialect does tell us is that the counters render INSIDE
 * that scope: this extractor's headline scan has had to exclude
 * `"<N> reactions"`-shaped runs found there since #800.  Narrow it the moment
 * a container is measured; an empty list is a recorded absence of evidence,
 * not a decision that none exists.
 *
 * The screen-scoped half of `ready` is weaker than the container-scoped half:
 * the screen contains the comment list, so a commenter's link can satisfy it
 * before the post body hydrates. That is accepted deliberately — it only
 * applies on the fallback path, where the alternative is no adapter at all,
 * and the extractor excludes `replaceableComment_` subtrees so a commenter
 * still cannot be picked as the author.
 */
const SDUI_POST_DETAIL_ADAPTER: VariantAdapter = {
  surface: "post-detail",
  variant: "sdui",
  detect: `${SDUI_CONTAINER}, ${SDUI_SCREEN}`,
  ready: authorLinkWithin([SDUI_CONTAINER, SDUI_SCREEN]),
  scopes: [SDUI_CONTAINER, SDUI_SCREEN],
  counts: [],
  extract: SDUI_POST_DETAIL_EXTRACT,
};

// ---------------------------------------------------------------------------
// post-detail :: legacy
// ---------------------------------------------------------------------------

/**
 * Post-detail extraction for the pre-SDUI (Ember / artdeco) dialect.
 *
 * **Provenance, stated precisely because the three parts have different
 * evidence behind them.  None of this adapter is fixture-verified: no
 * committed DOM fixture exists yet (#828 harvests them, #838 asserts
 * extraction against them).**
 *
 * *Measured* — live on 2026-08-31 against a fully-loaded 589 KB post-detail
 * page (LinkedHelper 2.130.29), the same probe run that recorded every SDUI
 * scraper selector matching 0: `[data-id^="urn:li:"]` matched 40,
 * `.update-components-text` matched 41, `span[dir="ltr"]` matched 82.
 *
 * *The shipped detect anchor is NOT one of those three.* It is
 * `[data-id^="urn:li:activity:"]` — a **narrowing** of the measured
 * `[data-id^="urn:li:"]`, because that measured selector also matches
 * `urn:li:comment:` entities and a comment is not the extraction root. The
 * narrowing is a hypothesis with two unmeasured halves, and it is worth
 * being blunt about both: that the 40 hits include at least one
 * `activity:` container (if they are all comment entities, this adapter
 * claims nothing and a legacy page is reported unsupported), and that
 * `data-id` never appears on an SDUI page (if it does, both adapters claim
 * healthy pages and extraction reports ambiguity). The second is the better
 * grounded of the two — the SDUI rewrite replaced `data-id` with
 * `componentkey` — but neither has a recorded count.
 *
 * *Field logic* — carried forward from the scraper this repository shipped
 * against this dialect before `15f5902` rewrote it for SDUI.  That code
 * demonstrably worked against this stack; the measured `span[dir="ltr"]`
 * count is consistent with it still applying.  Treat it as the current best
 * hypothesis with the evidence above, not as a verified claim.
 *
 * What is *not* carried forward is that scraper's `<main>`/`document` scope
 * fallback.  Scope resolution is confined to this dialect's own anchors; if
 * none matches, this adapter yields nothing and selection reports the page
 * unsupported.
 */
const LEGACY_POST_DETAIL_EXTRACT = `(function (scope) {
  var authorName = null;
  var authorHeadline = null;
  var authorProfileUrl = null;
  var text = null;
  var timestamp = null;

  // --- Author info ---
  const authorLink = scope.querySelector('a[href*="/in/"], a[href*="/company/"]');
  if (authorLink) {
    authorProfileUrl = (authorLink.href || '').split('?')[0] || null;

    // Read the copy a reader sees.  The previous read took the first
    // \`span[dir="ltr"]\` inside the link, which in this dialect WRAPS both
    // copies of the name — the visible one and its assistive-technology twin
    // — so it returned them concatenated: "Alexey PelykhAlexey Pelykh",
    // measured live on 2026-08-31 (#836).  Selecting the twin's wrapper
    // rather than its parent is what separates them.
    let rawName = __lhVisibleText(authorLink);

    // Fallback: LinkedIn sometimes renders the name outside the <a>.
    if (!rawName) {
      rawName = __lhVisibleText(authorLink.closest('div'));
    }

    authorName = __lhCleanName(rawName);
  }

  // --- Author headline ---
  // Scan runs inside scope for the first candidate the shared headline rule
  // accepts.  Both run shapes, not just this dialect's \`<span>\`: asking only
  // whether a run carries the headline — never which tag renders it — is what
  // keeps the rule one rule rather than two that can drift.
  authorHeadline = __lhFirstHeadline(
    Array.from(scope.querySelectorAll('p, span')),
    authorName,
  );

  // --- Post text ---
  // Prefer the dedicated commentary element; fall back to the longest
  // span[dir="ltr"] leaf, which is what the pre-SDUI scraper used.  Both
  // are within this dialect — this is not a cross-dialect cascade.
  const commentary = scope.querySelector('.update-components-text');
  if (commentary) {
    const t = (commentary.textContent || '').trim();
    if (t.length > 0) text = t;
  }
  if (text === null) {
    const ltrSpans = scope.querySelectorAll('span[dir="ltr"]');
    let longestText = '';
    for (const span of ltrSpans) {
      // Never the actor block.  Excluding it structurally rather than by
      // comparing against the extracted name is what keeps this contest
      // independent of how well that extraction went: this dialect wraps the
      // name and its assistive-technology twin in a \`span[dir="ltr"]\` of
      // exactly the shape the contest is looking for, and it is longer than
      // either field, so any text-equality guard lets it through the moment
      // the name is read as one copy rather than two.
      if (authorLink && authorLink.contains(span)) continue;
      const txt = (span.textContent || '').trim();
      if (txt.length > longestText.length && txt !== authorName && txt !== authorHeadline) {
        longestText = txt;
      }
    }
    if (longestText.length > 20) {
      text = longestText;
    }
  }

  // --- Timestamp ---
  const timeEl = scope.querySelector('time');
  if (timeEl) {
    const dt = timeEl.getAttribute('datetime');
    if (dt) timestamp = dt;
  }
  if (!timestamp) {
    const scopeText = scope.textContent || '';
    const timeMatch = scopeText.match(/(?:^|\\s)(\\d+[smhdw])(?:\\s|$|\\u00B7|\\xB7)/);
    if (timeMatch) timestamp = timeMatch[1];
  }

  return { authorName, authorHeadline, authorProfileUrl, text, timestamp };
})`;

/** The legacy update container, carrying the activity URN in `data-id`. */
const LEGACY_UPDATE_CONTAINER = '[data-id^="urn:li:activity:"]';

/** The legacy engagement-counts row.  Measured: 1 match on 2026-08-31. */
const LEGACY_SOCIAL_COUNTS = ".social-details-social-counts";

/**
 * Legacy (pre-SDUI) post-detail adapter.
 *
 * `detect` and the primary scope are the same element on purpose: the update
 * container carries `data-id="urn:li:activity:<id>"` in this dialect, so
 * "this dialect is present" and "here is the extraction root" are one
 * observation.  That coupling is what makes a *wrong scope anchor* impossible
 * to mistake for a legitimately empty post — if the container is not there,
 * detection yields nothing and the page is reported unsupported rather than
 * scraped into an empty record.
 *
 * The narrowing to the `activity` URN family, and its unmeasured status, are
 * documented on {@link LEGACY_POST_DETAIL_EXTRACT} above.
 *
 * `ready` is the author link inside that container — the same shape as the
 * SDUI adapter's, and for the same two reasons: it is the old gate's
 * author-link stage re-scoped from `<main>` to this dialect's own root, and
 * it proves the update actually hydrated rather than merely that its
 * container exists.
 *
 * `counts` is *measured*, unlike this adapter's detect anchor: the same
 * 2026-08-31 probe run recorded `.social-details-social-counts` matching
 * exactly 1, rendering `"2 41 comments"` — two reactions and forty-one
 * comments, side by side.
 */
const LEGACY_POST_DETAIL_ADAPTER: VariantAdapter = {
  surface: "post-detail",
  variant: "legacy",
  detect: LEGACY_UPDATE_CONTAINER,
  ready: authorLinkWithin([LEGACY_UPDATE_CONTAINER]),
  scopes: [LEGACY_UPDATE_CONTAINER],
  counts: [LEGACY_SOCIAL_COUNTS],
  extract: LEGACY_POST_DETAIL_EXTRACT,
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * The adapter registry — the ONE place a dialect is registered.
 *
 * Order within a surface is irrelevant to selection: selection requires
 * exactly one match, so it is order-independent by construction.  There is
 * deliberately no "default" or "last resort" entry.
 */
const ADAPTER_REGISTRY: Readonly<Record<Surface, readonly VariantAdapter[]>> = {
  "post-detail": [SDUI_POST_DETAIL_ADAPTER, LEGACY_POST_DETAIL_ADAPTER],
};

/** Adapters registered for a surface, in registration order. */
export function adaptersFor(surface: Surface): readonly VariantAdapter[] {
  return ADAPTER_REGISTRY[surface];
}

/**
 * Variant names registered for a surface — the `triedVariants` list a
 * `DOMVariantUnsupportedError` reports.
 */
export function variantNamesFor(surface: Surface): readonly DOMVariant[] {
  return adaptersFor(surface).map((adapter) => adapter.variant);
}

// ---------------------------------------------------------------------------
// In-page source generation
// ---------------------------------------------------------------------------

/**
 * Emit a JavaScript string literal for a selector.
 *
 * `JSON.stringify` is the right primitive here rather than wrapping in
 * quotes: selectors legitimately contain both quote characters (`[href*="/in/"]`)
 * and backslashes, and hand-quoting silently produces a syntax error or, worse,
 * a valid-but-different selector.
 */
function jsString(value: string): string {
  return JSON.stringify(value);
}

/**
 * The adapter table as an in-page array literal.  Every generated script
 * folds over this one array, which is what keeps "register a third adapter"
 * a registry-only edit.
 *
 * `withExtractors` is a blast-radius control, not an optimisation.  The
 * extractor sources are the largest and most defect-prone part of an adapter,
 * and only the extraction script runs them — so including them in the
 * readiness and detection scripts would mean a syntax error in ONE adapter's
 * extractor makes every readiness poll reject with an evaluate error, for
 * every dialect and every operation, for a reason that has nothing to do with
 * readiness.  Each script is handed only the fields it consumes.  (The
 * bandwidth saving on a 500 ms poll loop is real but incidental.)
 */
function adapterTableSource(
  adapters: readonly VariantAdapter[],
  withExtractors: boolean,
): string {
  const rows = adapters.map((adapter) => {
    const fields = [
      `variant: ${jsString(String(adapter.variant))}`,
      `detect: ${jsString(adapter.detect)}`,
      `ready: ${jsString(adapter.ready)}`,
    ];
    if (withExtractors) {
      fields.push(`scopes: [${adapter.scopes.map(jsString).join(", ")}]`);
      fields.push(`counts: [${adapter.counts.map(jsString).join(", ")}]`);
      fields.push(`extract: ${adapter.extract}`);
    }
    return `{ ${fields.join(", ")} }`;
  });
  return `[\n${rows.join(",\n")}\n]`;
}

/**
 * In-page selection, shared by every generated script.
 *
 * Defines `__lhSelect()` returning `{ matched: string[], adapter: object|null }`.
 * `adapter` is non-null only when exactly one detect anchor matched — the
 * zero and multiple cases are reported through `matched` so the caller can
 * raise the right error, and neither has a default.
 */
function selectionSource(
  adapters: readonly VariantAdapter[],
  withExtractors = false,
): string {
  return `const __lhAdapters = ${adapterTableSource(adapters, withExtractors)};
  function __lhSelect() {
    const matched = [];
    for (const a of __lhAdapters) {
      if (document.querySelector(a.detect) !== null) matched.push(a);
    }
    return {
      matched: matched.map(function (a) { return a.variant; }),
      adapter: matched.length === 1 ? matched[0] : null,
    };
  }`;
}

/**
 * Readiness predicate source.
 *
 * Returns `true` only when exactly one adapter claims the page AND that
 * adapter's own `ready` anchor is present.  Both halves matter: the
 * exclusivity check is what makes "the selected adapter" well-defined, and
 * polling the selected adapter's own anchor is the ADR-008 invariant.
 *
 * Zero-match and ambiguous pages return `false` rather than throwing here.
 * That is deliberate: a page that has not hydrated yet also matches zero
 * adapters, so an immediate raise would be indistinguishable from
 * "LinkedIn changed" and would fire on every slow load.  The caller
 * classifies once, at the deadline, when "not yet" has been ruled out.
 */
export function buildReadinessPredicateSource(
  adapters: readonly VariantAdapter[],
): string {
  return `(() => {
  ${selectionSource(adapters)}
  const selection = __lhSelect();
  if (!selection.adapter) return false;
  return document.querySelector(selection.adapter.ready) !== null;
})()`;
}

/**
 * Detection-classification source — which adapters claim this page.
 *
 * Returns `{ matched: string[], probes: Record<variant, number> }`.  The
 * per-adapter probe counts are the entire diagnosis for the next flip: a
 * line reading `sdui: 0, legacy: 0` says "new dialect", while
 * `sdui: 1, legacy: 1` says "hybrid page, tighten the detect anchors".
 */
export function buildDetectionSource(
  adapters: readonly VariantAdapter[],
): string {
  return `(() => {
  ${selectionSource(adapters)}
  const probes = {};
  for (const a of __lhAdapters) {
    probes[a.variant] = document.querySelectorAll(a.detect).length;
  }
  return { matched: __lhSelect().matched, probes: probes };
})()`;
}

/**
 * Shared in-page text helpers, emitted once at the top of the extraction
 * script and in scope for every adapter's `extract` source.
 *
 * Shared rather than copied per dialect because what differs between dialects
 * here is *where* a string is rendered, not how a rendered string is read —
 * and the two hand-maintained copies of the headline rule had already drifted
 * apart, with neither a superset of the other.  The dialect-specific part
 * stays in the extractors: which element to hand these helpers.
 *
 * Deliberately absent from the readiness and detection scripts, for the same
 * blast-radius reason {@link adapterTableSource} withholds the extractors from
 * them — neither script reads text, so a defect here cannot reach a poll loop.
 *
 * **Editing across the language seam.**  The literal below is TypeScript
 * emitting JavaScript, and the two languages share an escape character.  Every
 * backslash must be doubled to survive the crossing — `\\s` here is `\s`
 * there — and getting it wrong fails SILENTLY rather than loudly: an
 * unrecognised escape collapses to the bare character, so a lone `\s` emits
 * `/s+/`, a valid regex that matches the letter s.  Literal backticks must be
 * escaped for the same reason.  Both test tiers evaluate the emitted source,
 * so a *parse* error surfaces at once; a mis-escaped regex parses fine and
 * surfaces only where an assertion happens to depend on it.  The same holds
 * for the two `*_EXTRACT` constants above.
 */
function extractionHelpersSource(): string {
  return `
  // Text carrying no letter and no digit is decoration — a separator bullet,
  // an icon glyph — and is never a name, a headline or a count.
  const __LH_MEANINGFUL = /[\\p{L}\\p{N}]/u;

  // Collapse the whitespace \`textContent\` preserves, newlines included.
  function __lhSqueeze(text) {
    return (text || '').replace(/\\s+/g, ' ').trim();
  }

  // The text a reader actually sees inside \`el\`.
  //
  // LinkedIn writes many strings TWICE: the copy a reader sees, wrapped in
  // \`aria-hidden="true"\`, and an assistive-technology copy beside it.
  // \`textContent\` returns the pair concatenated with no separator, which is
  // how the post author's name came back as "Alexey PelykhAlexey Pelykh" —
  // measured live on 2026-08-31 (#836).
  //
  // The FIRST such wrapper wins, and the wrappers are deliberately NOT
  // joined: an actor block carries one per field — the name, the connection
  // degree, the headline, the timestamp — so joining them would swallow the
  // neighbouring fields into the first.  Taking the first in document order
  // also takes the OUTERMOST, because an ancestor precedes its descendants
  // and inherits their text.  Decoration-only wrappers are skipped, so a
  // separator bullet can never be mistaken for the string.
  function __lhVisibleText(el) {
    if (!el) return '';
    for (const node of el.querySelectorAll('[aria-hidden="true"]')) {
      const txt = __lhSqueeze(node.textContent);
      if (txt && __LH_MEANINGFUL.test(txt)) return txt;
    }
    return __lhSqueeze(el.textContent);
  }

  // "Alexey PelykhAlexey Pelykh" -> "Alexey Pelykh".  The assistive-technology
  // copy normally sits in its own wrapper and is excluded by reading the
  // visible one; this collapses the residue where a dialect renders both
  // copies inside ONE element, so no wrapper tells them apart.
  //
  // The repeated unit must be at least three characters, which keeps a real
  // two-character-per-half name ("LiLi") intact, and the whole string is
  // length-bounded because the backreference is quadratic in the worst case.
  function __lhDropRepeat(text) {
    if (text.length > 120) return text;
    const doubled = text.match(/^(.{3,}?)\\s*\\1$/);
    return doubled ? doubled[1].trim() : text;
  }

  // A display name with the decorations LinkedIn renders beside it removed.
  //
  // Each decoration truncates from its FIRST occurrence rather than anchoring
  // at the end of the string, because both were observed mid-string in the
  // live legacy record, whose name ran on into
  // "… • YouPremium • You … Software Architect | Agentic AI…" (#836).
  //
  // The badge rule is deliberately narrow — "Premium Profile", or a trailing
  // bare "Premium" — so that a company legitimately named "Premium Motors"
  // survives it.
  function __lhCleanName(raw) {
    let name = __lhSqueeze(raw);
    if (!name) return null;
    // No word boundary after the degree: the concatenated a11y twin runs
    // straight into it ("… • YouPremium • You …"), so requiring one skips the
    // first occurrence and truncates too late.  The bullet in front is what
    // keeps the rule from firing on an ordinary name.
    name = name.replace(
      /\\s*[\\u2022\\u00B7]\\s*(?:1st|2nd|3rd|Out of network|You)[\\s\\S]*$/i,
      '',
    );
    name = name.replace(/\\s*\\b(?:Verified|Premium)\\s+Profile\\b[\\s\\S]*$/i, '');
    name = name.replace(/\\s*\\b(?:Verified|Premium)\\s*$/i, '');
    name = __lhDropRepeat(__lhSqueeze(name));
    return name && __LH_MEANINGFUL.test(name) ? name : null;
  }

  // Whether \`txt\` is the author's NAME IN DISGUISE rather than a headline.
  // Two shapes qualify: \`txt\` reduces to the name under the same cleaning the
  // name read itself applies, or \`txt\` is nothing but that name repeated —
  // the a11y pair concatenated, and the same shape one copy further.  A plain
  // equality test let both through as the headline whenever the name itself
  // came back mangled, which is how \`authorHeadline\` came back holding the
  // NAME (#836).
  //
  // Deliberately NOT containment, which would also close that path: an
  // ordinary LinkedIn headline names its owner — "Jane Doe | Head of Data" —
  // so rejecting every candidate mentioning the author trades one silently
  // wrong field for a silently empty one.
  function __lhIsNameEcho(txt, authorName) {
    if (!authorName) return false;
    if (__lhCleanName(txt) === authorName) return true;
    let rest = __lhSqueeze(txt);
    while (rest.indexOf(authorName) === 0) {
      rest = __lhSqueeze(rest.slice(authorName.length));
    }
    return rest.length === 0 || !__LH_MEANINGFUL.test(rest);
  }

  // Does \`txt\` read as the author's headline?  The rejections below are the
  // strings rendered beside a headline in the actor block that would
  // otherwise win the scan.
  function __lhIsHeadline(txt, authorName) {
    if (!txt || txt.length <= 5 || txt.length >= 200) return false;
    if (__lhIsNameEcho(txt, authorName)) return false;
    if (/^\\d+[smhdw]$/.test(txt)) return false;
    if (/^\\d[\\d,]*\\s+(?:reactions?|comments?|reposts?|likes?)$/i.test(txt)) return false;
    if (/^(?:Follow|Following|Promoted|Boost|Author|You)$/i.test(txt)) return false;
    if (/^(?:Verified|Premium)(?:\\s+Profile)?$/i.test(txt)) return false;
    if (/^Skip to|^Keyboard shortcuts$|^Close jump menu$/i.test(txt)) return false;
    if (/^Feed\\s+(?:post|detail\\s+update)$/i.test(txt)) return false;
    if (/^Promote\\s+this\\s+post/i.test(txt)) return false;
    if (/Reaction button state:/.test(txt)) return false;
    if (/^https?:\\/\\//.test(txt)) return false;
    // A "<Name> • <degree>" composite.  Keyed on the degree rather than on
    // the bullet alone, so a headline that merely uses a bullet as its own
    // separator — "Software Architect • Agentic AI" — still qualifies.
    if (/[\\u2022\\u00B7]\\s*(?:1st|2nd|3rd|Out of network|You)\\b/i.test(txt)) return false;
    return __LH_MEANINGFUL.test(txt);
  }

  function __lhFirstHeadline(candidates, authorName) {
    for (const el of candidates) {
      const txt = __lhVisibleText(el);
      if (__lhIsHeadline(txt, authorName)) return txt;
    }
    return null;
  }

  // Two patterns per engagement counter.
  //
  // \`strict\` is anchored end to end, so it describes ONE element's whole
  // rendered text rather than a run found somewhere inside a larger one.  It
  // is what every read below tries first.
  //
  // \`loose\` is the same pattern unanchored, and it is admissible in exactly
  // one place: the whole text of a NARROWED counts row in which no single
  // element — the row itself included — reads as a counter on its own (see
  // \`__lhReadCount\`).  It exists because the row is
  // only *usually* built out of one control per counter — the shape the live
  // 2026-08-31 row had, and the shape everything below is designed around —
  // and a row that ever renders "2 41 comments" as one node should still
  // yield 41 rather than nothing.
  const __LH_COUNTERS = {
    reactionCount: {
      strict: /^(\\d[\\d,]*)\\s+reactions?$/i,
      loose: /(\\d[\\d,]*)\\s+reactions?/i,
    },
    commentCount: {
      strict: /^(\\d[\\d,]*)\\s+comments?$/i,
      loose: /(\\d[\\d,]*)\\s+comments?/i,
    },
    shareCount: {
      strict: /^(\\d[\\d,]*)\\s+reposts?$/i,
      loose: /(\\d[\\d,]*)\\s+reposts?/i,
    },
  };

  // The row the counters render in: the first of this adapter's own \`counts\`
  // candidates present inside the resolved scope, else the scope itself.
  //
  // \`narrowed\` records which of the two happened, because it decides whether
  // the loose pattern above may be used.  Inside a row whose only job is to
  // render counts, a looser read is warranted; inside a whole post container
  // it is not — that container holds the post's own prose, where a number
  // followed by the word "comments" is a sentence, not a counter.
  function __lhCountsRoot(adapter, scope) {
    for (const candidate of adapter.counts) {
      const el = scope.querySelector(candidate);
      if (el) return { el: el, narrowed: true };
    }
    return { el: scope, narrowed: false };
  }

  function __lhToCount(raw) {
    const num = parseInt(raw.replace(/,/g, ''), 10);
    return isNaN(num) ? 0 : num;
  }

  // One counter, read from the element that renders IT.
  //
  // Anchoring alone is not enough: an ancestor whose text concatenates two
  // counters — "2" and "41 comments" side by side flatten to "241 comments"
  // wherever no whitespace text node separates them — satisfies the pattern
  // too, just more coarsely than its own child.  So the DEEPEST hit of the
  // FIRST chain wins: document order picks the row, and containment picks the
  // leaf inside it.  A later chain is a different part of the page — a
  // comment's own counter, a reply affordance — and never overrides the row.
  //
  // \`aria-label\` is read alongside the text because LinkedIn renders the
  // reaction count as a bare number and puts the words on the control: "2",
  // labelled "2 reactions".  That is why the whole-page text read returned
  // \`reactionCount: 0\` on a post with two reactions.
  function __lhReadCount(root, counter) {
    const hits = [];
    for (const el of [root.el, ...root.el.querySelectorAll('*')]) {
      const label = el.getAttribute('aria-label') || '';
      const m =
        counter.strict.exec(label) ||
        counter.strict.exec(__lhSqueeze(el.textContent));
      if (m) hits.push({ el: el, raw: m[1] });
    }
    if (hits.length === 0) {
      // No element renders this counter on its own.  Inside a narrowed counts
      // row that means the row is not built the way the live one was, so read
      // the row's own text loosely rather than reporting a count it visibly
      // renders as absent.  Outside one it means the counter is not there,
      // and zero is the honest answer.
      if (!root.narrowed) return 0;
      const loose = counter.loose.exec(__lhSqueeze(root.el.textContent));
      return loose ? __lhToCount(loose[1]) : 0;
    }
    let best = hits[0];
    for (const hit of hits) {
      if (hit.el !== best.el && best.el.contains(hit.el)) best = hit;
    }
    return __lhToCount(best.raw);
  }
`;
}

/**
 * Post-detail extraction source.
 *
 * Selects the adapter, resolves its scope from its own ordered candidates,
 * and runs its extractor.  Returns:
 *
 * - the field bag plus the selected `variant`, on success
 * - `null` when no adapter claimed the page, or when the claiming adapter's
 *   scope anchors did not resolve — both are "no usable adapter", which the
 *   caller raises as unsupported
 * - `{ ambiguousVariants: [...] }` when two or more adapters claimed it
 *
 * Engagement counts are read from the selected adapter's own counts root,
 * one counter per element.  They used to be parsed out of
 * `document.body.textContent`, carried across the 2026-05 rewrite under the
 * claim that the text-content regex was dialect-independent and "the one part
 * of the scrape that kept working".  **That claim was false, and repeating it
 * is why the defect survived a second migration.**  Flattening a page into one
 * string does two things no number coming back can reveal: the first
 * `"<N> comments"`-shaped run *anywhere* on the page wins, wherever it is; and
 * two counters rendered side by side concatenate wherever no whitespace text
 * node separates them, so "2" and "41 comments" read as "241 comments".  The
 * live evidence for the first is `reactionCount: 0` returned for a post
 * carrying two reactions, whose count LinkedIn renders as a bare "2" with the
 * words only in the control's `aria-label`.
 */
export function buildPostDetailExtractionSource(
  adapters: readonly VariantAdapter[],
): string {
  return `(() => {
  ${extractionHelpersSource()}
  ${selectionSource(adapters, true)}
  const selection = __lhSelect();
  if (selection.matched.length > 1) {
    return { ambiguousVariants: selection.matched };
  }
  const adapter = selection.adapter;
  if (!adapter) return null;

  let scope = null;
  for (const candidate of adapter.scopes) {
    scope = document.querySelector(candidate);
    if (scope) break;
  }
  // No terminal fallback: an adapter that cannot resolve its own scope has
  // not read the page, and saying so is the whole point.
  if (!scope) return null;

  const fields = adapter.extract(scope);
  const countsRoot = __lhCountsRoot(adapter, scope);

  return {
    variant: adapter.variant,
    authorName: fields.authorName,
    authorHeadline: fields.authorHeadline,
    authorProfileUrl: fields.authorProfileUrl,
    text: fields.text,
    timestamp: fields.timestamp,
    reactionCount: __lhReadCount(countsRoot, __LH_COUNTERS.reactionCount),
    commentCount: __lhReadCount(countsRoot, __LH_COUNTERS.commentCount),
    shareCount: __lhReadCount(countsRoot, __LH_COUNTERS.shareCount),
  };
})()`;
}

/** Shape returned by {@link buildDetectionSource}. */
export interface VariantDetection {
  /** Variants whose detect anchor matched. */
  readonly matched: readonly string[];
  /** Match count per registered variant — the diagnosis for the next flip. */
  readonly probes: Readonly<Record<string, number>>;
}

/**
 * Narrow an untyped `Runtime.evaluate` result to {@link VariantDetection}.
 *
 * A probe result that is not well-formed is **not evidence** about the page:
 * it says the probe itself did not run usefully.  Callers must fall back to
 * their ordinary failure rather than reporting "no adapter matched", which
 * would blame LinkedIn for a broken instrument.
 */
export function asVariantDetection(value: unknown): VariantDetection | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { matched?: unknown; probes?: unknown };
  if (!Array.isArray(candidate.matched)) return null;
  if (!candidate.matched.every((entry) => typeof entry === "string")) {
    return null;
  }
  // Validate the probe VALUES, not just the container.  Casting an unchecked
  // object to `Record<string, number>` would make the narrowing unsound and
  // let a non-numeric count reach the diagnostic line as
  // `sdui: [object Object]` — a diagnosis is only worth printing if its
  // shape has been checked.  Non-numeric entries are dropped rather than
  // failing the whole result: `matched` is what decides the error class, and
  // it has already been validated.
  const probes: Record<string, number> = {};
  if (typeof candidate.probes === "object" && candidate.probes !== null) {
    for (const [variant, count] of Object.entries(candidate.probes)) {
      if (typeof count === "number" && Number.isFinite(count)) {
        probes[variant] = count;
      }
    }
  }
  return { matched: candidate.matched as readonly string[], probes };
}

/**
 * Render a {@link VariantDetection}'s probe counts as `sdui: 0, legacy: 0`
 * for an error message or a log line.
 */
export function formatVariantProbes(detection: VariantDetection): string {
  const entries = Object.entries(detection.probes);
  if (entries.length === 0) return "none registered";
  return entries.map(([variant, count]) => `${variant}: ${count}`).join(", ");
}
