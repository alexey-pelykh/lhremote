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
   * In-page JavaScript **function source** of the form
   * `(function (scope) { ...; return {...}; })`, evaluated with the resolved
   * scope element.  It returns the raw post-detail field bag.
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
    let nameText = '';
    for (const a of scope.querySelectorAll('a')) {
      if (a.getAttribute('href') !== targetHref) continue;
      const t = (a.textContent || '').trim();
      if (t.length > 0) { nameText = t; break; }
    }

    // Strip the SDUI " • <degree>" suffix from the name link text.
    // Format: "<Name>  • 1st" / "<Name> • 2nd" / "<Name>  • You" /
    // "<Name>  • 3rd".  Connection-degree separator is bullet (•).
    const m = nameText.match(/^(.+?)\\s+•\\s+(?:1st|2nd|3rd|Out of network|You)\\s*$/);
    authorName = (m ? m[1] : nameText).trim() || null;
  }

  // --- Author headline ---
  // After the author block, there's a headline element in <p> or <span>
  // form. Scan post container for a non-empty text leaf with length
  // 5..200 that is NOT the author name, NOT a relative-time marker,
  // NOT a UI label, and NOT a composite "<Name> • <degree>" span.
  const headlineCandidates = scope.querySelectorAll('p, span');
  for (const el of headlineCandidates) {
    if (el.closest('[componentkey^="replaceableComment_"]')) continue;
    const txt = (el.textContent || '').trim();
    if (
      txt &&
      txt.length > 5 &&
      txt.length < 200 &&
      txt !== authorName &&
      !txt.match(/^\\d+[smhdw]$/) &&
      !txt.match(/^\\d[\\d,]*\\s+(reactions?|comments?|reposts?|likes?)$/i) &&
      !txt.match(/^Follow$|^Promoted$|^Boost$|^Author$|^You$/i) &&
      !txt.match(/^Skip to|^Keyboard shortcuts$|^Close jump menu$/i) &&
      !txt.match(/^Feed\\s+(?:post|detail\\s+update)$/i) &&
      !txt.match(/^Promote\\s+this\\s+post/i) &&
      !txt.match(/Reaction button state:/) &&
      !txt.includes('•') &&
      !txt.match(/^https?:\\/\\//)
    ) {
      authorHeadline = txt;
      break;
    }
  }

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

    // Name from a span inside the link first; the legacy actor block wraps
    // the visible name in span[dir="ltr"] with an aria-hidden twin.
    const nameSpan = authorLink.querySelector('span[dir="ltr"], span[aria-hidden="true"]');
    let rawName = nameSpan ? (nameSpan.textContent || '').trim() : '';

    // Fallback: the link's own textContent, first line only.
    if (!rawName) {
      rawName = (authorLink.textContent || '').trim().split('\\n')[0].trim();
    }

    // Fallback: LinkedIn sometimes renders the name outside the <a>.
    if (!rawName) {
      const parent = authorLink.closest('div');
      if (parent) {
        const nearby = parent.querySelector('span[dir="ltr"], span[aria-hidden="true"]');
        if (nearby) rawName = (nearby.textContent || '').trim();
      }
    }

    authorName = rawName || null;
  }

  // --- Author headline ---
  // Scan spans inside scope, skipping navigation text and the author name.
  const allSpans = scope.querySelectorAll('span');
  for (const span of allSpans) {
    const txt = (span.textContent || '').trim();
    if (
      txt &&
      txt.length > 5 &&
      txt.length < 200 &&
      txt !== authorName &&
      !txt.match(/^\\d+[smhdw]$/) &&
      !txt.match(/^\\d[\\d,]*\\s+(reactions?|comments?|reposts?|likes?)$/i) &&
      !txt.match(/^Follow$|^Promoted$/i) &&
      !txt.match(/^Skip to|^Keyboard shortcuts$|^Close jump menu$/i) &&
      !txt.match(/^Feed detail update$|^Feed post$/i)
    ) {
      authorHeadline = txt;
      break;
    }
  }

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
 */
const LEGACY_UPDATE_CONTAINER = '[data-id^="urn:li:activity:"]';

const LEGACY_POST_DETAIL_ADAPTER: VariantAdapter = {
  surface: "post-detail",
  variant: "legacy",
  detect: LEGACY_UPDATE_CONTAINER,
  ready: authorLinkWithin([LEGACY_UPDATE_CONTAINER]),
  scopes: [LEGACY_UPDATE_CONTAINER],
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
 * Engagement counts are parsed from `document.body.textContent` outside the
 * adapter, unchanged: the text-content regex is dialect-independent and was
 * the one part of the scrape that kept working across the 2026-05 rewrite.
 */
export function buildPostDetailExtractionSource(
  adapters: readonly VariantAdapter[],
): string {
  return `(() => {
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

  // --- Engagement counts (dialect-independent) ---
  const countText = document.body.textContent || '';
  function parseCount(pattern) {
    const m = countText.match(pattern);
    if (!m) return 0;
    const raw = m[1].replace(/,/g, '');
    const num = parseInt(raw, 10);
    return isNaN(num) ? 0 : num;
  }

  return {
    variant: adapter.variant,
    authorName: fields.authorName,
    authorHeadline: fields.authorHeadline,
    authorProfileUrl: fields.authorProfileUrl,
    text: fields.text,
    timestamp: fields.timestamp,
    reactionCount: parseCount(/(\\d[\\d,]*)\\s+reactions?/i),
    commentCount: parseCount(/(\\d[\\d,]*)\\s+comments?/i),
    shareCount: parseCount(/(\\d[\\d,]*)\\s+reposts?/i),
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
