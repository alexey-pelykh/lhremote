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
 * ## Three surfaces
 *
 * Post detail, search results and the reactions modal are all registered.
 * They share detection, readiness and the no-terminal-fallback rule verbatim,
 * and differ only in what an extraction roots on and produces — one record
 * against one root, a list of records against a list of cards, or a list of
 * records against one root that only exists after a click.  Each surface
 * therefore narrows {@link VariantAdapter} into its own adapter type
 * ({@link PostDetailVariantAdapter}, {@link SearchResultsVariantAdapter},
 * {@link ReactionsModalVariantAdapter}) and has its own `build*Source`.
 *
 * ## Extending
 *
 * Registering a third dialect means appending one adapter to the surface's
 * array below.  Nothing at a call site branches on the variant — detection,
 * readiness and extraction are all *generated* from the array by the
 * `build*Source` functions — so no control flow changes.
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
 * Which adapter shape reads each surface.
 *
 * This one declaration IS the surface set and the per-surface adapter type,
 * which is what makes the registry below total: naming a surface here without
 * registering an adapter array for it is a compile error, and
 * {@link adaptersFor} hands each call site that surface's own adapter type
 * rather than the base.  Widening the surface set therefore cannot leave a
 * surface silently unregistered — the type checker walks the author to every
 * site that has to change.
 */
interface SurfaceAdapterMap {
  "post-detail": PostDetailVariantAdapter;
  "search-results": SearchResultsVariantAdapter;
  "reactions-modal": ReactionsModalVariantAdapter;
}

/**
 * A LinkedIn page kind being read.  Each surface owns its own adapter list,
 * because the same dialect renders different surfaces differently.
 */
export type Surface = keyof SurfaceAdapterMap;

/**
 * One dialect's binding for one surface — the part every surface's adapter
 * carries.
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
 * - {@link scopes} are the extraction roots, tried in order, all within this
 *   one dialect.  Ordering inside a dialect is a precision choice (tightest
 *   container first); it is not a cross-dialect cascade and it has no
 *   always-true terminal member.  What a *resolved* scope then means is per
 *   surface — see the two sub-interfaces below.
 * - {@link extract} is the field extraction for this dialect.  Its call
 *   signature and its returned field bag are per surface, for the same
 *   reason.
 *
 * Surfaces NARROW this rather than sharing one widened type: a field only one
 * surface consults — {@link PostDetailVariantAdapter.counts} — would
 * otherwise have to be carried as a dead empty array by every surface that
 * never reads it, and a field that gates nothing is ceremony a later reader
 * has to disprove.
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
   * `(function (...) { ...; return <result>; })`, evaluated by the surface's
   * extraction script.  BOTH ends are fixed per surface by that script and
   * neither is fixed here — see the sub-interfaces.
   *
   * The parameters vary (a resolved scope on post detail, a card and an author
   * name on search results, nothing at all on the reactions modal), and so
   * does what counts as a result: post detail and search results return a
   * FIELD BAG the caller reads named properties off, while the reactions modal
   * REINTERPRETS the whole contract and returns an `Element | null` — that
   * dialect's own modal-root resolver.  The reinterpretation is legitimate
   * because what differs between dialects there is the extraction *algorithm*,
   * which is exactly what this field carries; it is written out because
   * `extract` is typed `string`, so nothing mechanical catches a mismatch, and
   * this interface is the entry point a reader uses to register a new dialect.
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

/**
 * A post-detail adapter: one page, one post, one extraction root.
 *
 * {@link VariantAdapter.scopes} resolve to the SINGLE element the extractor
 * is handed, and {@link VariantAdapter.extract} is
 * `(function (scope) { ...; return { authorName, authorHeadline,
 * authorProfileUrl, text, timestamp }; })`.
 */
export interface PostDetailVariantAdapter extends VariantAdapter {
  readonly surface: "post-detail";
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
}

/**
 * A search-results adapter: one page, MANY result cards.
 *
 * Two inherited fields are reinterpreted, and that reinterpretation is why
 * this is a distinct type rather than a reuse of the post-detail one:
 *
 * - {@link VariantAdapter.scopes} are the **card-enumeration candidates**,
 *   tried in order, and the first candidate yielding at least one element
 *   wins.  They resolve to a LIST of cards, not to a single extraction root.
 *   The no-terminal-fallback rule is unchanged: when no candidate yields
 *   anything, the adapter yields nothing — it never widens to `<main>` or
 *   `document`.
 * - {@link VariantAdapter.extract} is
 *   `(function (card, authorName) { ...; return { authorHeadline, text,
 *   timestamp }; })`, run once per card.  Only those three fields are
 *   dialect-specific; everything else about a card is the shared skeleton
 *   both dialects render, and lives in
 *   {@link buildSearchResultsExtractionSource} rather than being copied into
 *   each extractor.
 *
 * It adds no field of its own.  It exists so a post-detail adapter cannot be
 * handed to the search-results extraction builder: the two extractors have
 * incompatible call signatures, and nothing at runtime would report the
 * mistake — the record would simply come back with every dialect-specific
 * field null, which is the exact silent-empty this module exists to remove.
 *
 * There is deliberately no `counts` here.  That field narrows the
 * engagement-counts row of ONE post; a search page renders one such row per
 * card, and per-card counts are read from the card's own text by the shared
 * builder.
 */
export interface SearchResultsVariantAdapter extends VariantAdapter {
  readonly surface: "search-results";
}

/**
 * A reactions-modal adapter: one post page, one trigger, one modal that only
 * exists after that trigger is clicked.
 *
 * This surface is read in FOUR generated scripts rather than one, because the
 * region it reads has to be *opened* first, and every field below is
 * reinterpreted against that sequence.  Nothing here is a new selection
 * mechanism — detection, readiness and scope resolution are the same three
 * rules the other two surfaces use.
 *
 * - {@link VariantAdapter.detect} is the **reactions TRIGGER on the post
 *   page**, not the modal wrapper.  The trigger is present both before and
 *   after the click, so one anchor serves pre-click dialect selection *and*
 *   keeps the readiness conjunction honest post-click ("exactly one adapter's
 *   `detect` matched AND that adapter's own `ready` is present").  Anchoring
 *   `detect` on the modal instead would make the dialect undecidable at the
 *   only moment it has to be decided — before the click, when there is no
 *   modal yet.  It is a candidate SET, not the trigger itself: which of those
 *   candidates *is* the trigger is decided by the shared accessible-name rule
 *   in {@link buildReactionsTriggerSource}, because that rule is what the two
 *   dialects genuinely share (one labels the control, the other renders the
 *   words as its text).
 * - {@link VariantAdapter.ready} is a **container-tier anchor of the OPEN
 *   modal** — an element the modal renders whether or not the engager list
 *   holds a single row.  Deliberately not "an engager link is present", which
 *   is what the pre-registry gate polled: that predicate cannot go green on a
 *   modal with zero engagers, so it made the legal genuinely-zero case
 *   indistinguishable from a timeout.  The container tier is what separates
 *   them now (ADR-008 § Decision 4), so readiness must stop just short of it.
 * - {@link VariantAdapter.scopes} are the **modal-root candidates**, tried in
 *   order, resolving to the SINGLE element the engager rows are read from.
 *   Resolving one IS the container tier: none resolving means this adapter did
 *   not read the modal, which raises rather than returning an empty list.  The
 *   no-terminal-fallback rule is unchanged — there is no widening to
 *   `document`.  First match wins only among candidates that pass
 *   {@link ReactionsModalVariantAdapter.rootSignal}; see that field for why a
 *   bare first match is not enough on this surface.
 * - {@link VariantAdapter.extract} is `(function () { ...; return
 *   <Element|null>; })` — this dialect's **own resolver for its modal root**,
 *   consulted only when none of its `scopes` candidates matched.  That is the
 *   reinterpretation, and it is where the two dialects actually differ: one
 *   modal carries a semantically-named wrapper class and needs no resolver at
 *   all, the other carries no selectable wrapper of any kind and can only be
 *   found by walking up from a control inside it (#773).  What a *found* row
 *   then reads as is NOT dialect-specific in anything measured, so the row
 *   read stays in {@link buildReactionsModalExtractionSource} rather than
 *   being copied into each extractor — two copies of one unmeasured read is
 *   exactly the drift the shared text helpers exist to prevent.
 *
 * It adds ONE field of its own, {@link rootSignal}.  There is deliberately no
 * `counts` here: that field narrows the engagement-counts row of a post, and
 * this surface reads a modal.  Its own cardinal — the reaction total — is
 * captured off the trigger before the click and read back after it, by
 * {@link buildReactionsModalTotalSource}.
 */
export interface ReactionsModalVariantAdapter extends VariantAdapter {
  readonly surface: "reactions-modal";
  /**
   * The anchor a resolved modal root must CONTAIN for this dialect — the
   * per-candidate validation gate on {@link VariantAdapter.scopes}.
   *
   * Every other surface can take a scope's first match: a post-detail scope is
   * `[data-urn^="urn:li:activity:"]` or a chameleon result container, anchors
   * that name the thing they wrap.  A modal-root candidate does not have that
   * property.  This dialect's are the generic `dialog` / `[aria-modal="true"]`
   * (sdui) and, for legacy, a wrapper LinkedIn may render alongside unrelated
   * overlays.  A cookie banner, a messaging overlay or a CLOSED `<dialog>`
   * — which still matches `querySelector('dialog')` — would otherwise be
   * returned as "the modal" purely by sitting earlier in document order.  Two
   * failures follow, one loud and one silent: an overlay with no engager rows
   * scrapes to `[]` and the cardinal tier raises on a modal that opened
   * perfectly, and an overlay that DOES carry `/in/` links returns people who
   * never reacted, with `extractedCount > 0` so nothing raises at all.
   *
   * The resolver therefore iterates EVERY match of every scope candidate and
   * accepts the first that contains this anchor.  That requirement is not new
   * — the pre-registry resolver `RESOLVE_REACTIONS_MODAL_SCRIPT` states and
   * implements it (`wait-for-reactions-modal.ts`, #773); the registry port
   * kept the candidate list and dropped the gate.
   *
   * **What it actually rules out, stated as a bound rather than as a
   * result.**  This gate rejects a candidate that matches the scope selector
   * but does NOT contain the dialect's container anchor.  That is all it
   * settles, and it is strictly weaker than identifying the modal: a decoy
   * that matches the scope AND happens to contain the anchor is accepted.
   * For legacy the anchor is `[role="tablist"]`, which is generic — any
   * overlay carrying a tab strip inside a `.social-details-reactors-modal`-
   * shaped wrapper would pass — so "narrow, not impossible" is the honest
   * reading, not "decoys are excluded".  It is worth having anyway, because
   * the shapes it filters are the ones this surface actually has to worry
   * about — a cookie banner, a messaging overlay, a CLOSED `<dialog>` — and
   * none of those holds a tab strip.  (That those shapes are what LinkedIn
   * renders alongside the modal is REASONED from the scope selectors being
   * generic, not measured: the 2026-09-02 probe recorded one dialog open, its
   * own.)  What would make it a proof of
   * identity is a *decisive* per-dialect anchor — one that names the reactors
   * modal rather than describing a modal — and for sdui that is the
   * measurement nobody has taken.
   *
   * It is deliberately per-ADAPTER rather than the union that resolver used.
   * A union cannot report which dialect it matched, which is the whole reason
   * this surface was registered — so each dialect validates with its own
   * container-tier anchor: legacy's tab strip, sdui's filter tab.  Both are
   * the same anchor that dialect's {@link VariantAdapter.ready} polls, which
   * is the point: readiness asks *has the modal's container rendered* and this
   * asks *is this candidate that container*, and answering them with two
   * different anchors would let a candidate pass one and fail the other.
   */
  readonly rootSignal: string;
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
const SDUI_POST_DETAIL_ADAPTER: PostDetailVariantAdapter = {
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
 * **Provenance, stated precisely because the parts have different evidence
 * behind them.**  Two captured legacy pages are now committed (#828) and the
 * Tier-2 oracle grades this adapter against them
 * (`__tests__/fixture-oracle.integration.test.ts`, #838), so the claims below
 * are no longer uniformly hypothesis — but they are not uniformly verified
 * either, and which is which is recorded per part.
 *
 * *Measured* — live on 2026-08-31 against a fully-loaded 589 KB post-detail
 * page (LinkedHelper 2.130.29), the same probe run that recorded every SDUI
 * scraper selector matching 0: `[data-id^="urn:li:"]` matched 40,
 * `.update-components-text` matched 41, `span[dir="ltr"]` matched 82.
 *
 * *The detect anchor is NOT one of those three, and its first version was
 * wrong* (#872).  It shipped as `[data-id^="urn:li:activity:"]` — a
 * **narrowing** of the measured `[data-id^="urn:li:"]`, because that measured
 * selector also matches `urn:li:comment:` entities and a comment is not the
 * extraction root.  The narrowing was right about the entity and wrong about
 * the ATTRIBUTE, and it was recorded here as a hypothesis with two unmeasured
 * halves.  The fixtures falsified the first outright: all 40 of those hits
 * ARE comment entities, the activity URN lives on `data-urn`, and the shipped
 * anchor therefore matched **zero** on a real legacy page — this adapter
 * could not detect the pages it exists to serve, and failed as "dialect
 * unsupported" rather than as a selector error.  {@link
 * LEGACY_UPDATE_CONTAINER} now reads `data-urn`, and the oracle asserts on
 * both fixtures that exactly this adapter claims the page.
 *
 * *The second half is still unmeasured; moving attribute moved it rather than
 * closing it.*  The original worry was that `data-id` might also appear on an
 * SDUI page, so that both adapters claim it and extraction reports ambiguity;
 * restated for `data-urn`, it is the same worry, and #828 captured legacy
 * pages only, so no SDUI fixture can settle it.  What the legacy fixtures DO
 * settle is the other direction: the SDUI adapter probes 0 on both, so a
 * legacy page is unambiguous.  The SDUI direction stays an inference — better
 * grounded than the falsified half was, since the SDUI rewrite replaced these
 * attributes with `componentkey`, but still without a recorded count.
 *
 * *Field logic* — carried forward from the scraper this repository shipped
 * against this dialect before `15f5902` rewrote it for SDUI.  The oracle now
 * grades a SUBSET of it against the fixtures: author name and profile link
 * non-empty, post text non-empty, and both engagement cardinals exact against
 * the `.measured.json` sidecar.  Headline and timestamp are NOT graded, and
 * for them the paragraph this replaces still holds — that code demonstrably
 * worked against this stack and the measured `span[dir="ltr"]` count is
 * consistent with it still applying, which is a best hypothesis, not a
 * verified claim.
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

/**
 * The legacy update container, carrying the activity URN in `data-urn`.
 *
 * **Which attribute holds it is measured, and it was the one thing this
 * anchor got wrong** (#872).  The two attributes split by ENTITY CLASS, not
 * by dialect: on the captured legacy post-detail page the update container
 * carries `data-urn` and no `data-id` at all, while every one of the 40
 * `data-id` URNs on that page is a `urn:li:comment:` entity.  So an anchor
 * naming a `urn:li:activity:` value reads `data-urn`; one naming a
 * `urn:li:comment:` value reads `data-id`.  Guessing between them fails
 * SILENTLY — a zero-match adapter does not claim the page, so the wrong
 * attribute is reported as "dialect unsupported" rather than as a selector
 * error, which is the same silent shape this whole migration exists to fix.
 */
const LEGACY_UPDATE_CONTAINER = '[data-urn^="urn:li:activity:"]';

/** The legacy engagement-counts row.  Measured: 1 match on 2026-08-31. */
const LEGACY_SOCIAL_COUNTS = ".social-details-social-counts";

/**
 * Legacy (pre-SDUI) post-detail adapter.
 *
 * `detect` and the primary scope are the same element on purpose: the update
 * container carries `data-urn="urn:li:activity:<id>"` in this dialect, so
 * "this dialect is present" and "here is the extraction root" are one
 * observation.  That coupling is what makes a *wrong scope anchor* impossible
 * to mistake for a legitimately empty post — if the container is not there,
 * detection yields nothing and the page is reported unsupported rather than
 * scraped into an empty record.
 *
 * **What the coupling does NOT buy, learned from #872.**  It converts a wrong
 * anchor into "dialect unsupported" — loud enough that no caller receives a
 * false empty record, and quiet enough that a *broken selector* reads exactly
 * like *a dialect nobody has registered yet*.
 *
 * Nothing at RUNTIME separates those two, and it is worth saying so here
 * because the nearest-looking instrument does not.  The diagnostic bundle's
 * `variantDetection` distinguishes a *broken probe* (absent or malformed)
 * from *no adapter claiming the page* (every count zero) — see
 * `get-post-engagers.ts` on that field.  A registered adapter whose anchor is
 * simply wrong lands in the SAME all-zero bucket as an unregistered dialect;
 * #872 produced exactly `{matched: [], probes: {sdui: 0, legacy: 0}}`.  The
 * Tier-2 fixture oracle is what tells them apart, and it can only do so
 * because its pages were captured rather than authored.
 *
 * Neither synthetic tier can catch this class, for two DIFFERENT reasons —
 * conflating them invites the wrong repair.  The unit tier builds its markup
 * FROM the adapter's own anchor, so it asserts against a page authored to
 * satisfy whatever that anchor happens to say; that is structural and no
 * amount of care fixes it.  The integration tier hand-writes its markup and
 * is therefore independent of the adapter's *code* — but not of its
 * *author's belief*, which is why its legacy container carried the same wrong
 * attribute and nine of its assertions went red on the corrected anchor.
 *
 * The `activity`-URN narrowing, the attribute it reads, and which half of its
 * original hypothesis the fixtures falsified are documented on
 * {@link LEGACY_POST_DETAIL_EXTRACT} above.
 *
 * `ready` is the author link inside that container — the same shape as the
 * SDUI adapter's, and for the same two reasons: it is the old gate's
 * author-link stage re-scoped from `<main>` to this dialect's own root, and
 * it proves the update actually hydrated rather than merely that its
 * container exists.
 *
 * `counts` was *measured* from the start, which the detect anchor was not:
 * the same 2026-08-31 probe run recorded `.social-details-social-counts`
 * matching exactly 1, rendering `"2 41 comments"` — two reactions and
 * forty-one comments, side by side.  The oracle now additionally grades what
 * that row PARSES to, against each fixture's `.measured.json` sidecar.
 */
const LEGACY_POST_DETAIL_ADAPTER: PostDetailVariantAdapter = {
  surface: "post-detail",
  variant: "legacy",
  detect: LEGACY_UPDATE_CONTAINER,
  ready: authorLinkWithin([LEGACY_UPDATE_CONTAINER]),
  scopes: [LEGACY_UPDATE_CONTAINER],
  counts: [LEGACY_SOCIAL_COUNTS],
  extract: LEGACY_POST_DETAIL_EXTRACT,
};

// ---------------------------------------------------------------------------
// search-results :: the card skeleton both dialects share
// ---------------------------------------------------------------------------

/**
 * A search-result card, structurally.  `role="listitem"` is ARIA, not part of
 * either dialect's attribute scheme, and commit `24052dd` — the change that
 * moved this surface OFF the legacy dialect — carries it as an UNCHANGED
 * CONTEXT line.  It was the card skeleton before that migration and after it.
 */
const SEARCH_RESULT_LISTITEM = 'div[role="listitem"]';

/**
 * The per-card three-dot control menu.
 *
 * **Adjudicated as dialect-independent**, which is why it lives here in the
 * shared skeleton rather than inside either adapter.  Three grounds, and they
 * are recorded because a fourth `[data-testid]`-looking site next to three
 * that flipped is exactly the thing a later reader would "fix" by moving:
 *
 * 1. It is an ARIA label, not part of the `data-testid` attribute scheme that
 *    measured 0 document-wide when LinkedIn reverted to legacy on 2026-08-31.
 * 2. It was measured **working on pre-SDUI markup** — 2026-03-27, on the FEED
 *    page, in `research/linkedin/feed-dom-selectors-20260326.md` § 13.
 * 3. It was measured **present on the post-flip search page** — 2026-04-15, in
 *    `research/linkedin/feed-dom-text-extraction-20260415.md` § 6 — and it
 *    survived `24052dd` as an unchanged context line, like the listitem above.
 *
 * It is also the load-bearing one: a card without it is skipped outright, so
 * had it been dialect-bound, EVERY card would have been skipped and the result
 * set would have come back empty — a stronger and earlier failure than any
 * null text field.
 *
 * Deliberately NOT `FEED_POST_MENU_BUTTON` from `selectors.ts`: that constant
 * is scoped `[data-testid="mainFeed"] div[role="listitem"] button[...]`, which
 * is both SDUI-bound and feed-bound.  Reusing it would narrow search results
 * to the feed wrapper and match nothing here.
 */
const SEARCH_RESULT_MENU_BUTTON =
  'button[aria-label^="Open control menu for post"]';

/** The author anchor on a card — a member profile or a company page. */
const SEARCH_RESULT_AUTHOR_LINK = 'a[href*="/in/"], a[href*="/company/"]';

/**
 * A result card's control menu button, addressed from the document root.
 *
 * It carries two roles, and they are the same element rather than two
 * selectors that happen to agree.
 *
 * **Role 1 — the readiness anchor for this surface.  Both dialects
 * deliberately share it, and that is not the shared-anchor defect ADR-008
 * § Decision 1 forbids.**  The readiness predicate is a CONJUNCTION: exactly
 * one adapter's `detect` matched AND that adapter's own `ready` is present.
 * The dialect binding therefore already lives in `detect`, which is
 * dialect-exclusive; `ready` carries the orthogonal claim that a result card
 * has HYDRATED, and the card skeleton is precisely what the two dialects share
 * (above).  Inventing a per-dialect hydration anchor would mean asserting a
 * measurement nobody has taken.  It keeps the ADR-008 binding intact in the
 * sense that matters: the gate polls an anchor the selected adapter's own
 * extraction REQUIRES — a card with no menu button is skipped by the shared
 * card loop.
 *
 * **Role 2 — the element `search-posts.ts` clicks** to read each post's URL
 * off the "Copy link to post" item, which is why this is exported.  That is
 * the one site outside this module addressing the same element, and it used to
 * hand-write the same two parts a third time.  Rename the label and the
 * readiness gate, the card filter and the URL read must all move together; a
 * second copy drifting would leave the URL read matching nothing while the
 * scrape still succeeds, which is this module's own failure mode one level up.
 */
export const SEARCH_RESULT_CARD_MENU_BUTTON = `${SEARCH_RESULT_LISTITEM} ${SEARCH_RESULT_MENU_BUTTON}`;

// ---------------------------------------------------------------------------
// search-results :: sdui
// ---------------------------------------------------------------------------

/**
 * Search-result field extraction for the SDUI dialect LinkedIn served from
 * 2026-04.
 *
 * Carried over verbatim from the strategy-1 body of the
 * `SCRAPE_SEARCH_RESULTS_SCRIPT` that shipped in `search-posts.ts`, minus the
 * card skeleton, which is now shared.  Its selectors are *measured*: the
 * 2026-04-15 live probe of `/search/results/content/` recorded
 * `[data-testid="expandable-text-box"]` present once per post and the `<p>`
 * elements of the second author link carrying name, degree, headline and
 * timestamp — on the same page where `span[dir="ltr"]` matched 0 per post.
 *
 * `authorName` is unused here; it is part of the shared calling convention
 * because the legacy extractor needs it.
 */
const SDUI_SEARCH_RESULTS_EXTRACT = `(function (card, authorName) {
  var authorHeadline = null;
  var text = null;
  var timestamp = null;

  // Author headline + timestamp: the text-bearing SECOND author link.  Each
  // card carries two links to the author profile — the first holds only an
  // avatar (<figure>), the second holds <p> elements with name, degree,
  // headline and timestamp.
  //
  // The link is re-queried here rather than handed in: the shared builder
  // reads it to answer a different question (the profile URL), and a
  // two-parameter extractor signature is what keeps every dialect's extractor
  // interchangeable.
  const authorLink = card.querySelector(${jsString(SEARCH_RESULT_AUTHOR_LINK)});
  if (authorLink) {
    const authorPath = new URL(authorLink.href).pathname;
    const allLinks = Array.from(card.querySelectorAll('a[href*="' + authorPath + '"]'));
    const textLink = allLinks.find(function (a) { return (a.textContent || '').trim().length > 0; });

    if (textLink) {
      const pEls = Array.from(textLink.querySelectorAll('p'));

      // Timestamp: last <p> carrying a relative-time token (e.g. "18h •").
      for (let i = pEls.length - 1; i >= 0; i--) {
        const txt = (pEls[i].textContent || '').trim();
        const timestampMatch = txt.match(/^(\\d+[smhdw])(?:\\s|[\\u2022\\u00B7]|$)/);
        if (timestampMatch) {
          timestamp = timestampMatch[1];
          pEls.splice(i, 1);
          break;
        }
      }

      // Headline: 3rd <p> (index 2) — after name and connection degree.
      // Company posts may carry only 2 <p> elements (name + timestamp), in
      // which case the headline stays null.
      if (pEls.length >= 3) {
        authorHeadline = (pEls[2].textContent || '').trim() || null;
      }
    }
  }

  // Post text: the expandable text box with its "… more" affordance stripped.
  // The clone is what keeps the strip from mutating the live page.
  const textBox = card.querySelector('[data-testid="expandable-text-box"]');
  if (textBox) {
    const clone = textBox.cloneNode(true);
    const moreBtn = clone.querySelector('[data-testid="expandable-text-button"]');
    if (moreBtn) moreBtn.remove();
    text = (clone.textContent || '').trim() || null;
  }

  return { authorHeadline: authorHeadline, text: text, timestamp: timestamp };
})`;

/**
 * SDUI search-results adapter.
 *
 * `detect` is the SDUI text box **inside a result card**, not the bare
 * attribute: scoping it to the listitem is what makes it say "this is a
 * search-results page speaking SDUI" rather than merely "some SDUI is on this
 * page".  It is exclusive by measurement — `[data-testid]` matched 0
 * document-wide under legacy on 2026-08-31 — so it cannot collide with the
 * legacy adapter below and selection cannot report a false ambiguity.
 *
 * It is also post-content-bound, and that is load-bearing for the empty-vs-
 * error contract: a zero-result search page renders no post text, so it does
 * not select this adapter at all and never reaches the cardinal check.
 */
const SDUI_SEARCH_RESULTS_ADAPTER: SearchResultsVariantAdapter = {
  surface: "search-results",
  variant: "sdui",
  detect: `${SEARCH_RESULT_LISTITEM} [data-testid="expandable-text-box"]`,
  ready: SEARCH_RESULT_CARD_MENU_BUTTON,
  scopes: [SEARCH_RESULT_LISTITEM],
  extract: SDUI_SEARCH_RESULTS_EXTRACT,
};

// ---------------------------------------------------------------------------
// search-results :: legacy
// ---------------------------------------------------------------------------

/**
 * Search-result field extraction for the pre-SDUI dialect.
 *
 * **Provenance, stated precisely.**  The 2026-08-31 legacy-reversion probe
 * covered the **post-detail** surface only; *no live legacy probe of a
 * search-results page exists*.  This dialect is therefore RECONSTRUCTED from
 * two records rather than measured:
 *
 * - the 2026-03-26 selector study, which recorded search results exposing
 *   activity URNs through `data-chameleon-result-urn`;
 * - the diff of commit `24052dd` (2026-04-15), the migration that replaced
 *   exactly this field logic with the SDUI logic above.  What it replaced is
 *   what is restored here.
 *
 * One thing from that diff is deliberately NOT restored: its name read
 * (`authorLink.querySelector('span[dir="ltr"], span[aria-hidden="true"]')`).
 * That read was already broken — the first `a[href*="/in/"]` on a card is
 * avatar-only, with empty text and no `span[dir="ltr"]` — and moving the name
 * onto the menu-button `aria-label` is *why* `24052dd` was written.  Reviving
 * it would ship a known bug under a new name.  The name comes from the shared
 * builder, for both dialects.
 *
 * Treat all of this as the current best hypothesis with the evidence above,
 * not as a verified claim.  It is still strictly better than the alternative
 * it replaces: under legacy markup every `[data-testid]` matches zero, so the
 * SDUI extractor returns null for every field on every card.
 */
const LEGACY_SEARCH_RESULTS_EXTRACT = `(function (card, authorName) {
  var authorHeadline = null;
  var text = null;
  var timestamp = null;

  // --- Author headline ---
  // First <span> run that reads as a headline.  The rejections are the
  // strings rendered beside a headline on a result card that would otherwise
  // win the scan: a relative timestamp, an engagement counter, a Follow or
  // Promoted affordance, and the author's own name — which is what the
  // \`authorName\` parameter is for, and its only use.
  for (const span of card.querySelectorAll('span')) {
    const txt = (span.textContent || '').trim();
    if (!txt) continue;
    if (txt.length <= 5 || txt.length >= 200) continue;
    if (txt === authorName) continue;
    if (/^\\d+[smhdw]$/.test(txt)) continue;
    if (/^\\d[\\d,]*\\s+(?:reactions?|comments?|reposts?|likes?)$/i.test(txt)) continue;
    if (/^Follow$|^Promoted$/i.test(txt)) continue;
    authorHeadline = txt;
    break;
  }

  // --- Post text ---
  // The longest \`span[dir="ltr"]\` that is neither the name nor the headline.
  // The length floor is what keeps a stray label from winning when the post
  // body itself failed to render.
  let longestText = '';
  for (const span of card.querySelectorAll('span[dir="ltr"]')) {
    const txt = (span.textContent || '').trim();
    if (txt.length > longestText.length && txt !== authorName && txt !== authorHeadline) {
      longestText = txt;
    }
  }
  if (longestText.length > 20) text = longestText;

  // --- Timestamp ---
  const timeEl = card.querySelector('time');
  if (timeEl) {
    const dt = timeEl.getAttribute('datetime');
    if (dt) timestamp = dt;
  }
  if (!timestamp) {
    const cardText = card.textContent || '';
    const timeMatch = cardText.match(/(?:^|\\s)(\\d+[smhdw])(?:\\s|$|\\u00B7)/);
    if (timeMatch) timestamp = timeMatch[1];
  }

  return { authorHeadline: authorHeadline, text: text, timestamp: timestamp };
})`;

/** The legacy search-result container, carrying the activity URN. */
const LEGACY_RESULT_CONTAINER = "[data-chameleon-result-urn]";

/**
 * Legacy (pre-SDUI) search-results adapter.
 *
 * `detect` is the chameleon result container.  Its exclusivity is measured
 * from the other side: the 2026-04-15 probe of the post-flip search page
 * recorded `data-chameleon-result-urn` matching **0**, so it cannot claim an
 * SDUI page, just as the SDUI adapter's `data-testid` anchor cannot claim a
 * legacy one.  Neither can match the other's dialect, so selection cannot
 * report a false ambiguity.
 *
 * `scopes` is tightest-first: the chameleon container, then the structural
 * listitem.  **Status of that second candidate, stated rather than implied:**
 * with `detect` and `scopes[0]` being the same selector, a page that selects
 * this adapter always resolves `scopes[0]`, so the listitem entry is a
 * structural fallback that becomes live only if this dialect's detect anchor
 * is ever widened to something that is not itself the card container.  It is
 * kept because the enumeration root and the detection anchor are separate
 * concerns and the ordered list is where that separation is expressed — not
 * because a page exists today that reaches it.
 */
const LEGACY_SEARCH_RESULTS_ADAPTER: SearchResultsVariantAdapter = {
  surface: "search-results",
  variant: "legacy",
  detect: LEGACY_RESULT_CONTAINER,
  ready: SEARCH_RESULT_CARD_MENU_BUTTON,
  scopes: [LEGACY_RESULT_CONTAINER, SEARCH_RESULT_LISTITEM],
  extract: LEGACY_SEARCH_RESULTS_EXTRACT,
};

// ---------------------------------------------------------------------------
// reactions-modal :: what the two dialects share
// ---------------------------------------------------------------------------

/**
 * How deep the SDUI resolver walks up from a control inside the modal before
 * giving up.
 *
 * 12 crosses the modal wrapper plus typical layout chrome (toolbar,
 * root-of-modal, portal host).  It does NOT on its own stop the walk running
 * away into `<body>` — the depth cap was once described as if it did, and it
 * cannot: on a page listing people, `<body>` satisfies the walk's termination
 * condition and is comfortably within 12 hops of the filter tab.  What stops
 * it is {@link REACTIONS_MODAL_FORBIDDEN_SCOPE}; this bound is the second
 * guard, for a page whose chrome is deeper than anything recorded.
 *
 * Carried over from the resolver this replaces (`wait-for-reactions-modal.ts`,
 * #773), which still uses its own copy for the diagnostic ancestor-chain probe
 * — deliberately, because that probe reports the shape of a page NO adapter
 * could read, and tying it to an adapter would narrow the one artifact that
 * has to stay wider than any binding.
 */
const REACTIONS_MODAL_WALK_DEPTH = 12;

/**
 * Elements this module refuses to return as a modal scope, whatever else they
 * satisfy.
 *
 * The rule the resolvers on this surface obey, stated once: a document-level
 * element is never "the modal".  Accepting one scopes the engager scrape to
 * the whole page, and the failure that follows is the silent kind — a page
 * that lists people anywhere (a feed, a search result, a "People also viewed"
 * rail) yields `/in/` links, so the operation reports strangers as reactors
 * with `extractedCount > 0` and no tier fires.
 *
 * It is the same refusal the `scopes` path already makes structurally by
 * having no terminal `document` fallback; the walk needs it spelled out
 * because a walk chooses its own terminus.  `<main>` is in the list for the
 * same reason as the three document-level nodes: it is a page landmark, so an
 * element that IS `<main>` is the page, not a region inside it.
 *
 * Matched with `Element.matches`, not compared against `document.body` and
 * friends by identity: identity cannot express `<main>` at all, and the
 * extraction source is separately pinned to read no page-wide text.
 */
const REACTIONS_MODAL_FORBIDDEN_SCOPE = "body, html, head, main";

/**
 * An engager's profile link inside the modal — the row anchor the shared read
 * enumerates, and the termination signal the SDUI resolver walks toward.
 */
const REACTIONS_MODAL_ENGAGER_LINK = 'a[href*="/in/"]';

/**
 * How far the row walk climbs from an engager link's parent before giving up.
 *
 * Deliberately much tighter than {@link REACTIONS_MODAL_WALK_DEPTH}, which
 * crosses a modal's layout chrome: this one crosses a ROW's, and a reactor row
 * is a shallow structure — an avatar, a name lockup, a headline, a pictogram,
 * an action button.  Four levels covers the deepest nesting any recorded
 * dialect puts between the anchor and its row (`li > div > div > a`) with a
 * level to spare; a walk that has climbed further without finding row content
 * has left the row.
 *
 * The walk is bounded by the modal as well, so this cap only binds on a modal
 * whose rows are deeper than anything observed — in which case the fallback
 * below it is what answers.
 */
const REACTIONS_MODAL_ROW_WALK_DEPTH = 4;

/**
 * What a reactor ROW holds that the anchor alone does not: a headline
 * candidate or a reaction pictogram.
 *
 * The structural signal the row walk accepts on.  Deliberately not a class
 * name: no SDUI row selector has ever been measured, and guessing one is what
 * this module refuses to do everywhere else.  These are the two things the row
 * read actually consumes, so an ancestor holding either is by construction an
 * ancestor the read can work with.
 */
const REACTIONS_MODAL_ROW_CONTENT = "p, span, img[alt]";

// ---------------------------------------------------------------------------
// reactions-modal :: legacy
// ---------------------------------------------------------------------------

/**
 * The legacy reactions trigger — the control that opens the engager modal.
 *
 * *Measured* live on 2026-09-02 against a legacy post-detail page carrying two
 * reactions: `<button data-reaction-details="" aria-label="2 reactions"
 * class="…social-details-social-counts__count-value…">`, and clicking it was
 * verified to open the modal.
 *
 * Its `textContent` is the bare string `"2"` — the word "reactions" exists
 * ONLY in `aria-label`, with reaction-icon `<img>` elements in between.  That
 * is why the text-only finder this replaces matched NOTHING on that page (the
 * 2026-08-31 probe recorded the same strict pattern matching 0 document-wide),
 * so the modal was never opened and the operation reported `engagers: []` with
 * `total: 0` on a post that has two — #823 on this path.
 *
 * **Deliberately document-wide, and the residual risk is stated rather than
 * papered over.**  Its SDUI sibling IS root-scoped
 * ({@link SDUI_REACTIONS_MODAL_ADAPTER}), so the two dialects apply opposite
 * rules on one surface, which is worth justifying.  On a post that HAS
 * reactions, its own counts row precedes every comment in document order and
 * {@link buildReactionsTriggerSource} takes the first visible hit, so the
 * measured case cannot pick the wrong control.  The exposure is a post with
 * ZERO reactions where some other `[data-reaction-details]` on the page reads
 * `"<N> reactions"` — a comment's own reactor count, say — which would be
 * clicked and scraped as if it were the post's, and would self-corroborate,
 * because the cardinal is stamped off that same wrong control.
 *
 * **That exposure is CONFIRMED REACHABLE, not merely reasoned.**  An
 * independent probe on 2026-09-02 built exactly that page — a zero-reaction
 * post whose comment carries `aria-label="7 reactions"` — and this source
 * returns `true` on it and stamps a cardinal of 7.  Nothing downstream can
 * detect the substitution: both tiers see one consistent observation.
 *
 * Scoping it to {@link LEGACY_SOCIAL_COUNTS} would close that, and the
 * element's own `social-details-social-counts__count-value` class says it is a
 * BEM child of exactly that block.  It is NOT done here because the containment
 * was never MEASURED: the 2026-09-02 probe recorded the element, and the
 * 1-match reading of the counts row is from the separate 2026-08-31 probe.
 * Narrowing a working, measured anchor on an inference is the move this file
 * refuses everywhere else, and it would break extraction outright if the
 * inference is wrong — a worse failure than the one it prevents.
 *
 * One probe settles both this and the zero-reaction premise below: open a
 * zero-reaction legacy post and record (a) whether any
 * `[data-reaction-details]` renders at all, and (b) whether the post's own
 * trigger is a descendant of `.social-details-social-counts`.  See ADR-008
 * § 2026-09-02 Amendment (#840).
 *
 * **The converse exclusivity direction lives here, and it is REASONED.**  Its
 * SDUI sibling's non-match under legacy is measured (`[componentkey]` matched
 * 0 on the 2026-08-31 probe).  That this attribute matches 0 under SDUI is
 * not: `data-reaction-details` is the artdeco-era attribute the SDUI rewrite
 * is understood to have replaced, an inference from the attribute scheme
 * rather than an observation, because LinkedIn is not serving SDUI to this
 * account.  If it is wrong, both reactions-modal adapters claim the page and
 * the operation raises `DOMVariantAmbiguousError` on every SDUI post.  Same
 * form the legacy search adapter states its own converse in.
 */
const LEGACY_REACTIONS_TRIGGER = "button[data-reaction-details]";

/**
 * The legacy reactors-modal wrapper.  *Measured* 2026-09-02:
 * `<div data-test-modal role="dialog" class="artdeco-modal …
 * social-details-reactors-modal" aria-labelledby="social-details-reactors-modal__header">`.
 *
 * DECISIVE among the anchors that element carries: it is semantically named
 * for the reactors list and it sits on the wrapper itself.  The generic
 * alternatives on the same element — `[data-test-modal]` and `[role="dialog"]`
 * — describe *a* modal rather than *this* one, and `[role="dialog"]` measured
 * 1 on that page only because this was the one dialog open; either would
 * resolve an unrelated overlay on a page where the reactors modal is absent.
 */
const LEGACY_REACTORS_MODAL = ".social-details-reactors-modal";

/**
 * The same wrapper addressed through the header it labels.  *Measured* on the
 * same element (`#social-details-reactors-modal__header` resolves), and kept
 * as the second candidate because it survives a class rename while staying
 * bound to the reactors modal by name — unlike the two generic anchors above,
 * which survive a rename by ceasing to identify anything in particular.
 */
const LEGACY_REACTORS_MODAL_BY_LABEL =
  '[aria-labelledby="social-details-reactors-modal__header"]';

/**
 * The legacy modal's own tab strip — this dialect's container-tier anchor.
 *
 * *Measured* 2026-09-02: four `[role="tab"]` elements inside a
 * `[role="tablist"]`, present independently of whether the engager list held a
 * single row.  It serves two bindings that must not drift apart: scoped to the
 * wrapper it is this adapter's `ready`, and unscoped it is its
 * {@link ReactionsModalVariantAdapter.rootSignal} — the same question asked of
 * the page and of one candidate.
 */
const LEGACY_REACTIONS_TABLIST = '[role="tablist"]';

/** `<root> [role="tablist"]` for each root. */
function tablistWithin(roots: readonly string[]): string {
  return roots.map((root) => `${root} ${LEGACY_REACTIONS_TABLIST}`).join(", ");
}

/**
 * Legacy reactions-modal resolver: there is nothing left to resolve.
 *
 * Stated as an explicit `null` rather than by copying the SDUI walk below,
 * because that walk is *measured dead* under this dialect — the 2026-09-02
 * probe recorded its anchor, `button[aria-label$=" All reactions"]`, matching
 * 0 while the modal was open.  A resolver that cannot fire is not a fallback,
 * it is dead code with a comment justifying it.
 */
const LEGACY_REACTIONS_MODAL_RESOLVE = `(function () {
  return null;
})`;

/**
 * Legacy (pre-SDUI) reactions-modal adapter — the *measured* one.
 *
 * `ready` is the modal's own tab strip, scoped to whichever of this dialect's
 * two wrapper anchors is present.  *Measured*: four `[role="tab"]` elements
 * inside a `[role="tablist"]`, present independently of whether the engager
 * list holds a single row.  Two things make it the right anchor and not merely
 * a working one.  It is strictly stronger than the wrapper alone, which can be
 * present in a skeleton state before the list region renders — the same
 * argument the post-detail adapters make for gating on the author link rather
 * than the container.  And it stops short of the engager rows themselves,
 * which is what makes a genuinely-zero modal reach the cardinal tier instead
 * of timing out.
 *
 * `scopes` is tightest-first and both candidates are the same measured
 * element, so a page that selects this adapter resolves `scopes[0]`; the
 * second entry becomes live only if the class is renamed.  It is recorded as
 * such rather than described as a live path.
 *
 * `rootSignal` is that same tab strip unscoped, so a candidate is accepted as
 * the modal only when it holds one.  Cheap here — the measured wrapper carries
 * it — and it is what stops a second `.social-details-reactors-modal`-shaped
 * element earlier in the document from being taken for this one.
 */
const LEGACY_REACTIONS_MODAL_ADAPTER: ReactionsModalVariantAdapter = {
  surface: "reactions-modal",
  variant: "legacy",
  detect: LEGACY_REACTIONS_TRIGGER,
  ready: tablistWithin([LEGACY_REACTORS_MODAL, LEGACY_REACTORS_MODAL_BY_LABEL]),
  scopes: [LEGACY_REACTORS_MODAL, LEGACY_REACTORS_MODAL_BY_LABEL],
  rootSignal: LEGACY_REACTIONS_TABLIST,
  extract: LEGACY_REACTIONS_MODAL_RESOLVE,
};

// ---------------------------------------------------------------------------
// reactions-modal :: sdui
// ---------------------------------------------------------------------------

/**
 * The modal's "All reactions" filter tab.
 *
 * The ONE anchor recorded present on this dialect's engager modal: the #773
 * Phase-1 diagnostic capture reported `reactionsButtonAriaLabels` including
 * `"24 All reactions"` on a page where every canonical modal wrapper matched
 * zero and the modal was visibly open.
 */
const SDUI_ALL_REACTIONS_TAB = 'button[aria-label$=" All reactions"]';

/** `<scope> button, <scope> [role="button"], <scope> span, <scope> a`. */
function controlCandidatesWithin(scopes: readonly string[]): string {
  return scopes
    .flatMap((scope) => [
      `${scope} button`,
      `${scope} [role="button"]`,
      `${scope} span`,
      `${scope} a`,
    ])
    .join(", ");
}

/**
 * SDUI reactions-modal resolver — the tab-anchor ancestor walk from #773.
 *
 * Carried over verbatim from `RESOLVE_REACTIONS_MODAL_SCRIPT`'s stage 2, minus
 * the canonical-wrapper stage that precedes it there, which is now this
 * adapter's `scopes`.  It exists because this dialect's modal carries no
 * selectable wrapper at all — the Phase-1 capture measured zero matching
 * dialog wrappers *while the modal was open* — so the only way to name the
 * region is to start from a control known to be inside it and walk up until an
 * ancestor holds engager links.
 *
 * **Its termination condition is engager links, and that is a recorded
 * limitation of this dialect, not a design choice.**  A genuinely-zero SDUI
 * modal has no engager links, so the walk resolves nothing and the scrape
 * raises where the legacy path would return an empty list.  Fixing it needs a
 * container-tier anchor for THIS dialect, which is the measurement nobody has
 * taken; inventing one would put a guessed selector where § Decision 3
 * requires a decisive one.  LinkedIn is serving legacy today, so the falsifier
 * is a live probe of an SDUI zero-reaction post's modal.
 *
 * **That termination condition is also not a validation, and the walk carries
 * its own refusal because of it.**  "Holds engager links" is satisfied by
 * every ancestor up to and including `<body>` on any page that lists people
 * elsewhere — a feed behind the modal is enough — so within
 * {@link REACTIONS_MODAL_WALK_DEPTH} the walk could return the document body,
 * after which the scrape is scoped to the whole page and returns strangers as
 * reactors with `extractedCount > 0`, which no tier can contradict.  It
 * therefore rejects every element in {@link REACTIONS_MODAL_FORBIDDEN_SCOPE}
 * as a result and keeps climbing, which on a document-level ancestor means
 * resolving nothing at all.  Refusing is the correct answer there: the caller
 * raises, which is loud, where the alternative ships wrong data quietly.
 */
const SDUI_REACTIONS_MODAL_RESOLVE = `(function () {
  const tab = document.querySelector(${jsString(SDUI_ALL_REACTIONS_TAB)});
  if (!tab || tab.offsetHeight === 0) return null;
  let ancestor = tab.parentElement;
  let depth = 0;
  while (ancestor && depth < ${String(REACTIONS_MODAL_WALK_DEPTH)}) {
    if (
      !ancestor.matches(${jsString(REACTIONS_MODAL_FORBIDDEN_SCOPE)}) &&
      ancestor.querySelectorAll(${jsString(REACTIONS_MODAL_ENGAGER_LINK)}).length > 0
    ) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
    depth++;
  }
  return null;
})`;

/**
 * SDUI reactions-modal adapter.
 *
 * **Provenance, stated precisely, because none of it has the standing of the
 * legacy adapter above.**  LinkedIn is serving legacy right now, so this
 * dialect's reactions modal cannot be probed and every anchor here is
 * RECONSTRUCTED from the record rather than measured on a page.  The
 * precedent for writing a reconstructed adapter honestly is
 * {@link LEGACY_SEARCH_RESULTS_ADAPTER}; the same rule applies — treat this as
 * the current best hypothesis with the evidence named, not as a verified
 * claim.
 *
 * `detect` is the SDUI post-detail roots' own control candidates.  Two parts,
 * with different evidence:
 *
 * - The roots carry UNEQUAL evidence, and only one of the two is measured.
 *   {@link SDUI_CONTAINER} (`[componentkey]`) matched **0** document-wide on
 *   the 2026-08-31 legacy probe, and #800 recorded the post-detail container
 *   present across all four post types under SDUI.  {@link SDUI_SCREEN}
 *   (`[data-sdui-screen="…"]`) has NO recorded count anywhere: it is an
 *   inference from the same attribute scheme.  So "cannot claim a legacy page"
 *   is measured for the first root and reasoned for the second.
 *
 *   The exclusivity conclusion is also TWO-DIRECTIONAL where the measurement
 *   is one-directional.  Only *this* anchor not matching legacy is measured;
 *   the converse — `data-reaction-details` matching 0 under SDUI — is recorded
 *   on {@link LEGACY_REACTIONS_TRIGGER} as an inference, because LinkedIn is
 *   not serving SDUI to this account.  What that costs if either direction is
 *   wrong is a total outage rather than a degraded read: both reactions-modal
 *   adapters would claim the page and the operation would raise
 *   `DOMVariantAmbiguousError` on EVERY post of the affected dialect.  Stated
 *   here so a reader diagnosing that is not doing it against a comment
 *   claiming the collision was measured impossible.
 * - The candidate list inside them is *the one the pre-#840 finder used*
 *   (`button, [role="button"], span, a`), now confined to the dialect it was
 *   measured working in: #773's capture recorded the modal visibly OPEN under
 *   SDUI, which it could only be if that finder matched and the click landed.
 *   Confining it is the whole point — as a document-wide list it also ran on
 *   legacy pages, where it matches nothing, and reported "no reactions".
 *
 * It is deliberately BROADER than the legacy trigger anchor, and that is not a
 * concession: no CSS anchor for this dialect's trigger has ever been recorded
 * — what was recorded is that the trigger renders the words "N reactions" as
 * its own text — so precision here comes from the shared accessible-name rule
 * in {@link buildReactionsTriggerSource}, not from the selector.  The one
 * consequence worth stating is that this adapter claims every SDUI
 * post-detail page, including a post with no reactions at all; the trigger
 * search then finds nothing and the operation returns an empty list — which is
 * the right answer for that post *on a reasoned, unmeasured premise*, not a
 * measured one.  The premise is that a zero-reaction post renders no trigger;
 * the 2026-09-02 spike measured a post WITH reactions and the zero case was
 * never observed.  Falsifier: a live probe of a zero-reaction post's DOM.  See
 * {@link buildReactionsTriggerSource}, which owns the full statement of it.
 *
 * `ready` is the modal's filter tab — the one anchor recorded present on this
 * dialect's modal (see {@link SDUI_ALL_REACTIONS_TAB}).  Whether it renders on
 * a modal with zero engagers is unmeasured; its label carried a count in the
 * one recording of it.
 *
 * `scopes` are the canonical wrappers the pre-registry resolver tried first.
 * They are recorded here as *known insufficient* rather than as a live path:
 * the Phase-1 capture measured zero of them on the open modal, which is why
 * {@link SDUI_REACTIONS_MODAL_RESOLVE} exists and is load-bearing alone.  They
 * are kept because a restoration would take effect without a code change, and
 * because deleting them would leave this adapter with no `scopes` at all.
 *
 * They are also the reason {@link ReactionsModalVariantAdapter.rootSignal}
 * exists: both are generic ARIA wrappers that match any modal on the page,
 * including a closed `<dialog>`, so accepting one unvalidated would resolve an
 * unrelated overlay as this dialect's engager modal.  `rootSignal` is the
 * filter tab — the ONE anchor recorded present on this dialect's modal, and
 * the same anchor `ready` polls — so a restored wrapper is accepted only when
 * it actually holds the modal.  Deliberately not the engager link: that would
 * make a genuinely-zero SDUI modal unresolvable through `scopes` too, which is
 * already this dialect's recorded limitation on the resolver path and is not
 * worth spreading.
 */
const SDUI_REACTIONS_MODAL_ADAPTER: ReactionsModalVariantAdapter = {
  surface: "reactions-modal",
  variant: "sdui",
  detect: controlCandidatesWithin([SDUI_CONTAINER, SDUI_SCREEN]),
  ready: SDUI_ALL_REACTIONS_TAB,
  scopes: ["dialog", '[aria-modal="true"]'],
  rootSignal: SDUI_ALL_REACTIONS_TAB,
  extract: SDUI_REACTIONS_MODAL_RESOLVE,
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
 *
 * The mapped type over {@link SurfaceAdapterMap} is what makes this table
 * total AND per-surface typed at once: a new key in that map is a compile
 * error here until its adapters are registered, and each surface's array
 * keeps its own adapter type rather than collapsing to the base — which is
 * how `buildPostDetailExtractionSource` goes on type-checking against
 * `counts` while the search-results builder cannot be handed a post-detail
 * adapter.
 */
const ADAPTER_REGISTRY: {
  readonly [S in Surface]: readonly SurfaceAdapterMap[S][];
} = {
  "post-detail": [SDUI_POST_DETAIL_ADAPTER, LEGACY_POST_DETAIL_ADAPTER],
  "search-results": [
    SDUI_SEARCH_RESULTS_ADAPTER,
    LEGACY_SEARCH_RESULTS_ADAPTER,
  ],
  "reactions-modal": [
    SDUI_REACTIONS_MODAL_ADAPTER,
    LEGACY_REACTIONS_MODAL_ADAPTER,
  ],
};

/**
 * Adapters registered for a surface, in registration order.
 *
 * Generic over the surface so a caller passing a literal (`"post-detail"
 * as const`) gets that surface's own adapter type back.  Passing the `Surface`
 * union yields the union of both, which is all a variant-agnostic consumer
 * needs.
 */
export function adaptersFor<S extends Surface>(
  surface: S,
): readonly SurfaceAdapterMap[S][] {
  return ADAPTER_REGISTRY[surface];
}

/**
 * Variant names registered for a surface — the `triedVariants` list a
 * `DOMVariantUnsupportedError` reports.
 */
export function variantNamesFor(surface: Surface): readonly DOMVariant[] {
  // Widened to the base type on the way in: this reads `variant` and nothing
  // else, and a union of per-surface arrays is awkward to map over.
  const adapters: readonly VariantAdapter[] = adaptersFor(surface);
  return adapters.map((adapter) => adapter.variant);
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
      // Emitted only where the adapter declares one, rather than as an empty
      // array on every row.  The key is structural — "does this adapter carry
      // counts?" — rather than a branch on the surface, because the only
      // consumer, `__lhCountsRoot`, is keyed on the field and not on the page
      // kind.  A search-results row would otherwise carry a field its own
      // extraction script never reads.
      if (hasCounts(adapter)) {
        fields.push(`counts: [${adapter.counts.map(jsString).join(", ")}]`);
      }
      // Same structural rule, same reason: only the reactions-modal surface
      // declares a root signal, and only its resolver reads one.
      if (hasRootSignal(adapter)) {
        fields.push(`rootSignal: ${jsString(adapter.rootSignal)}`);
      }
      fields.push(`extract: ${adapter.extract}`);
    }
    return `{ ${fields.join(", ")} }`;
  });
  return `[\n${rows.join(",\n")}\n]`;
}

/** Does this adapter narrow an engagement-counts row? */
function hasCounts(
  adapter: VariantAdapter,
): adapter is VariantAdapter & { readonly counts: readonly string[] } {
  return "counts" in adapter;
}

/** Does this adapter validate its resolved root against a signal? */
function hasRootSignal(
  adapter: VariantAdapter,
): adapter is VariantAdapter & { readonly rootSignal: string } {
  return "rootSignal" in adapter;
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
 * Emitted WHOLE, though, so a consumer that needs only some of it carries the
 * rest: the reactions-modal extraction script uses the name and headline
 * helpers and never calls the engagement-counts ones
 * (`__LH_COUNTERS` … `__lhReadCount`), which post-detail alone reads.  That is
 * a deliberate trade rather than an oversight — one block, one escape audit,
 * and the withholding above is per-SCRIPT-KIND, which is where the blast
 * radius actually lives.  Splitting it per consumer would give three blocks to
 * keep in escape-agreement for no runtime benefit, since the payload cost is a
 * few hundred bytes on a call that already ships an adapter table.  Named here
 * because "shared text helpers" undersells what the block now contains.
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
    // The affordance labels rendered beside a name.  The last three arrived
    // with the reactions modal (#840), whose engager rows carry a
    // Connect / Message / Pending control each; every one of them clears the
    // five-character floor above, so without this they read as headlines.
    if (/^(?:Follow|Following|Promoted|Boost|Author|You|Connect|Message|Pending)$/i.test(txt)) return false;
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
      if (el) return __lhCountsRootOf(el, true);
    }
    return __lhCountsRootOf(scope, false);
  }

  // \`nodes\` is flattened once here rather than inside \`__lhReadCount\`, which
  // runs once per counter and would otherwise walk the same subtree three
  // times per post.
  function __lhCountsRootOf(el, narrowed) {
    return { el: el, narrowed: narrowed, nodes: [el, ...el.querySelectorAll('*')] };
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
    for (const el of root.nodes) {
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
  adapters: readonly PostDetailVariantAdapter[],
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

/**
 * Search-results extraction source.
 *
 * Selects the adapter, enumerates result cards from that adapter's own
 * ordered `scopes` candidates, and runs its extractor once per card.
 * Returns:
 *
 * - `{ variant, postCardCount, posts }` on success
 * - `null` when no adapter claimed the page, OR when the claiming adapter
 *   resolved no cards from any of its own candidates — both are "no usable
 *   adapter", which the caller raises as unsupported.  There is no terminal
 *   fallback here either: an adapter that cannot enumerate its own cards has
 *   not read the page
 * - `{ ambiguousVariants: [...] }` when two or more adapters claimed it
 *
 * ## What is shared, and why it is not per-dialect
 *
 * Everything about a card except three fields is the skeleton BOTH dialects
 * render (see {@link SEARCH_RESULT_MENU_BUTTON} for the adjudication):
 * enumeration, the height filter, the menu-button filter, the author name
 * parsed out of that button's `aria-label`, the profile URL, the media type
 * and the three engagement counters.  Only `authorHeadline`, `text` and
 * `timestamp` differ, and those are what `adapter.extract` returns.  Copying
 * the skeleton into each extractor would let two copies of one measurement
 * drift apart, which is the failure the shared text helpers above already
 * exist to prevent one level down.
 *
 * ## `postCardCount` — the cardinal, and why it is defined exactly this way
 *
 * It counts enumerated cards that are POST-SHAPED **excluding the
 * menu-button filter**: cards clearing the height floor AND carrying an
 * author link.  Two properties, and neither survives a redefinition:
 *
 * - **It is non-vacuous.**  Every *other* filter in the card loop is shared
 *   with the count, so the count and `posts.length` diverge on exactly one
 *   condition — the menu-button filter, which is the dominant suspected
 *   failure path.  A cardinal defined as "cards that yielded a post" would
 *   always equal `posts.length` and could never contradict it, which is a
 *   corroborator that cannot fail.
 * - **It cannot false-raise on a genuinely empty search.**  Chrome and
 *   "no results" blocks carry no author link and are excluded; and the SDUI
 *   `detect` anchor is post-content-bound, so a zero-result page selects no
 *   adapter and never reaches the check at all.
 *
 * The caller feeds it to `assertCardinalCorroboration`; see ADR-008
 * § Decision 4.
 */
export function buildSearchResultsExtractionSource(
  adapters: readonly SearchResultsVariantAdapter[],
): string {
  return `(() => {
  ${selectionSource(adapters, true)}
  const selection = __lhSelect();
  if (selection.matched.length > 1) {
    return { ambiguousVariants: selection.matched };
  }
  const adapter = selection.adapter;
  if (!adapter) return null;

  // Card enumeration: this adapter's own candidates, in order, first one
  // yielding at least one element wins.
  let cards = [];
  for (const candidate of adapter.scopes) {
    const found = document.querySelectorAll(candidate);
    if (found.length > 0) { cards = Array.from(found); break; }
  }
  // No terminal fallback, exactly as on post detail: an adapter that cannot
  // enumerate its own cards has not read the page, and saying so is the point.
  if (cards.length === 0) return null;

  function __lhParseCount(text, pattern) {
    const m = text.match(pattern);
    if (!m) return 0;
    const num = parseInt(m[1].replace(/,/g, ''), 10);
    return isNaN(num) ? 0 : num;
  }

  const posts = [];
  let postCardCount = 0;

  for (const card of cards) {
    // --- Shared with the cardinal: is this card post-shaped at all? ---
    if (card.offsetHeight < 100) continue;
    const authorLink = card.querySelector(${jsString(SEARCH_RESULT_AUTHOR_LINK)});
    if (!authorLink) continue;
    postCardCount++;

    // --- The ONE filter deliberately NOT shared with the cardinal ---
    // A card with no control menu yields no post.  Counting it anyway is what
    // makes an all-cards-skipped scrape contradict its own page instead of
    // reporting a search that found nothing.
    const menuBtn = card.querySelector(${jsString(SEARCH_RESULT_MENU_BUTTON)});
    if (!menuBtn) continue;

    // Author name: parsed out of the menu button's label, for BOTH dialects.
    // The card's own first author anchor is avatar-only — empty text, no
    // name — which is why the name was moved here in the first place.
    const menuLabel = menuBtn.getAttribute('aria-label') || '';
    const authorNameMatch = menuLabel.match(/^Open control menu for post by\\s+(.+)$/);
    const authorName = authorNameMatch ? authorNameMatch[1].trim() || null : null;

    const authorProfileUrl = (authorLink.href || '').split('?')[0] || null;

    let mediaType = null;
    if (card.querySelector('video')) {
      mediaType = 'video';
    } else if (card.querySelector('img[src*="media.licdn.com"]')) {
      for (const img of card.querySelectorAll('img[src*="media.licdn.com"]')) {
        if (img.offsetHeight > 100) { mediaType = 'image'; break; }
      }
    }

    // Per-post engagement counts, read unanchored from the card's own text.
    // Deliberately unchanged: post detail moved to anchored per-element
    // counting, this surface has not, and moving it is a behaviour change of
    // its own.
    const cardText = card.textContent || '';

    const fields = adapter.extract(card, authorName);

    posts.push({
      url: null,
      authorName: authorName,
      authorHeadline: fields.authorHeadline,
      authorProfileUrl: authorProfileUrl,
      text: fields.text,
      mediaType: mediaType,
      reactionCount: __lhParseCount(cardText, /(\\d[\\d,]*)\\s+reactions?/i),
      commentCount: __lhParseCount(cardText, /(\\d[\\d,]*)\\s+comments?/i),
      shareCount: __lhParseCount(cardText, /(\\d[\\d,]*)\\s+reposts?/i),
      timestamp: fields.timestamp,
    });
  }

  return { variant: adapter.variant, postCardCount: postCardCount, posts: posts };
})()`;
}

/**
 * In-page modal-root resolution for the reactions-modal surface, shared by
 * every generated script that needs the OPEN modal.
 *
 * Defines `__lhReactionsModalRoot()` returning one of three shapes, mirroring
 * the three selection outcomes exactly:
 *
 * - `{ ambiguousVariants: [...] }` — two or more adapters claimed the page
 * - `null` — no adapter claimed it, OR the claiming adapter resolved neither
 *   its own `scopes` candidates nor its own resolver.  Both are "no usable
 *   adapter"; the caller raises rather than reporting an empty modal
 * - `{ modal, variant }` — the resolved root and the dialect that resolved it
 *
 * **Every match of every scope candidate is examined, and each is validated
 * against the adapter's own {@link ReactionsModalVariantAdapter.rootSignal}
 * before it is accepted.**  Taking `querySelector`'s single first hit would
 * hand back whichever `dialog` / `[aria-modal="true"]` / wrapper sits earliest
 * in document order — a cookie banner, an unrelated overlay, or a CLOSED
 * `<dialog>`, all of which still match — and the caller has no way to tell
 * that from the real modal.  See that field for the two failure modes and for
 * why the gate is per-adapter rather than the cross-dialect union the
 * pre-registry resolver used.
 *
 * Emitted once per consuming script rather than shared through a global,
 * because each consumer composes its own `Runtime.evaluate` expression and
 * there is no page state between them to hang a helper on.
 */
function reactionsModalRootSource(
  adapters: readonly ReactionsModalVariantAdapter[],
): string {
  return `${selectionSource(adapters, true)}
  function __lhReactionsModalRoot() {
    const selection = __lhSelect();
    if (selection.matched.length > 1) {
      return { ambiguousVariants: selection.matched };
    }
    const adapter = selection.adapter;
    if (!adapter) return null;
    for (const candidate of adapter.scopes) {
      // querySelectorAll, not querySelector: a candidate that merely sits
      // earliest in the document is not the modal, and rejecting it is the
      // whole point of the signal check below.
      for (const el of document.querySelectorAll(candidate)) {
        if (el.querySelector(adapter.rootSignal)) {
          return { modal: el, variant: adapter.variant };
        }
      }
    }
    // This dialect's OWN resolver, for a modal whose wrapper carries no
    // selectable anchor.  Not a terminal fallback: it belongs to the selected
    // adapter and it is allowed to return nothing.
    //
    // It is deliberately NOT re-gated by \`rootSignal\` here, and the reason is
    // what the resolver is FOR.  A dialect reaches it only because its modal
    // carries no selectable wrapper, so the resolver starts FROM that
    // dialect's \`rootSignal\` anchor and walks UP: every element it can return
    // contains that anchor by construction, and re-asking would be asking the
    // question the walk began with.
    //
    // What the walk owes instead is a refusal of its own, and it carries one:
    // it rejects every element this module forbids as a scope, so it cannot
    // answer with the document body on a page that lists people outside the
    // modal.  The ground recorded here before #840 round 2 — that stopping on
    // an ancestor holding engager links IS the validation — was wrong, and
    // wrong in the unsafe direction: on a people-listing page every ancestor
    // up to \`<body>\` satisfies it.
    const resolved = adapter.extract();
    return resolved ? { modal: resolved, variant: adapter.variant } : null;
  }`;
}

/**
 * Reactions-trigger source — find the control that opens the engager modal,
 * mark it for the humanized scroll + click, and record its cardinal.
 *
 * Returns `true` when a trigger was marked, `false` when this page has no
 * reactions affordance for the selected dialect, and
 * `{ ambiguousVariants: [...] }` when two or more adapters claimed the page.
 *
 * **`false` is deliberately not an error, and this is the one surface where
 * that is true.**  On post detail and search results a page no adapter claims
 * raises `DOMVariantUnsupportedError`, because a post-detail page always has a
 * post.  Here a third reading is both common and benign — the post has no
 * reactions, so no affordance is rendered — and raising would throw on
 * ordinary posts.  Two or more adapters matching is still a hybrid page and
 * still refuses to guess.  See ADR-008 § 2026-09-02 Amendment (#840).
 *
 * **That third reading is REASONED, not measured, and the bound belongs here
 * rather than only in the amendment.**  A zero-reaction post is *believed* to
 * render no `[data-reaction-details]` trigger at all, which would make an
 * absent trigger a clean genuinely-zero discriminator.  The 2026-09-02 spike
 * measured a post WITH reactions; the zero case was not observed.  Its
 * falsifier is a live probe of a zero-reaction post's DOM: if such a post
 * renders a trigger reading `"0 reactions"`, this branch is unreachable on it
 * and the modal opens on an empty list instead — which the container tier
 * handles correctly anyway.  What the bound forbids is the inverse
 * "simplification": treating a not-found trigger as a POSITIVE zero signal,
 * which would re-open #823 through the one branch that deliberately returns
 * empty.
 *
 * **The recognition rule is shared across dialects on purpose.**  A trigger is
 * a VISIBLE candidate whose ACCESSIBLE NAME — `aria-label` first, own text
 * second — is exactly `"<N> reactions"`.  Both halves are measured, one per
 * dialect: legacy labels the control `aria-label="2 reactions"` and renders
 * only `"2"` as text (2026-09-02), while SDUI rendered the words as the
 * element's text (#773, whose capture recorded the modal open, which the
 * click could not have achieved otherwise).  Reading only the text is exactly
 * what the finder this replaces did, and it is why the modal was never opened
 * under legacy — the defect at the head of #823 on this path.  Which elements
 * are even offered to the rule is per dialect and comes from `detect`.
 *
 * The cardinal is stamped onto the trigger here, before the click, and read
 * back after it by {@link buildReactionsModalTotalSource}.  That is the whole
 * reason to stamp rather than return it: the modal's own header is a worse
 * source (it renders the bare word "Reactions" and its tab reads `"All 2"`
 * without the parentheses the old read required), and reading the trigger
 * costs no additional `Runtime.evaluate` at all when it rides on the marker
 * this script already writes.
 */
export function buildReactionsTriggerSource(
  adapters: readonly ReactionsModalVariantAdapter[],
): string {
  return `(() => {
  ${selectionSource(adapters)}
  const selection = __lhSelect();
  if (selection.matched.length > 1) {
    return { ambiguousVariants: selection.matched };
  }
  const adapter = selection.adapter;
  if (!adapter) return false;

  const name = /^(\\d[\\d,]*)\\s+reactions?$/i;
  for (const el of document.querySelectorAll(adapter.detect)) {
    if (!(el.offsetHeight > 0)) continue;
    const label = (el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    const hit = name.exec(label) || name.exec(text);
    if (!hit) continue;
    el.setAttribute('data-lhremote-reactions', 'true');
    el.setAttribute('data-lhremote-reactions-total', hit[1]);
    return true;
  }
  return false;
})()`;
}

/**
 * Reactions-total source — the cardinal that corroborates an empty engager
 * scrape.
 *
 * Returns a number, always.  Reads, in order:
 *
 * 1. the cardinal stamped on the trigger before the click
 *    ({@link buildReactionsTriggerSource}).  Preferred because it comes from
 *    the control whose accessible name IS the count, rather than from prose
 *    the modal happens to render;
 * 2. failing that, the modal's own text — `"<N> reactions"`, then an
 *    `"All"` tab count.
 *
 * The parentheses around that tab count are **optional**, and that is a fix,
 * not a loosening: the read this replaces required `"All (2)"` and legacy
 * renders `"All 2"`, so with the modal open and two engagers inside it the
 * function returned 0 — a self-contradiction pointing the opposite way from
 * #823, and one that would have made a real contradiction look corroborated.
 *
 * `0` is returned when nothing could be read, which is the value that makes an
 * empty scrape legal.  That is the honest answer here: a cardinal is only
 * evidence of a contradiction when it is positive, and inventing a positive
 * one from a failed read would raise on a page nobody has looked at.
 *
 * **Step 2 is STRUCTURAL under legacy, not a live path — say so rather than
 * let a reader infer it is the fix.**  This script runs only after the find
 * call returned `true`, and that return happens only after the trigger was
 * stamped with a cardinal parsed out of `/^(\d[\d,]*)\s+reactions?$/`.  Those
 * captured digits always survive `__lhToTotal`, so step 1 returns and step 2
 * is unreachable — *unless* the marked element left the DOM between the two
 * calls.  Under legacy that same element IS the adapter's `detect`, so losing
 * it also loses selection and `__lhReactionsModalRoot()` returns `null`, which
 * still stops short of the text reads.  Only the SDUI dialect, whose `detect`
 * is a broad candidate set that can survive the loss, leaves step 2 reachable
 * in production.  It is kept for that dialect and as the honest belt-and-braces
 * for the read that returned 0 — deleting it would re-open #823's inverse the
 * moment either premise moves.
 *
 * The consequence to keep in view: the parenthesis fix is exercised by Tier-1
 * and is correct, but on legacy the defect it repairs is already headed off one
 * step earlier.  Step 2's reads are also UNANCHORED — they flatten the whole
 * modal, which is exactly the read post-detail abandoned (see
 * {@link extractionHelpersSource}'s `__lhReadCount`).  On the SDUI path that is
 * a live over-match risk: an engager headline reading "overall 20 years" would
 * satisfy the `"All"` pattern.  Anchoring it needs a measured SDUI count
 * element, which needs a live SDUI page — the same blocker as everything else
 * unmeasured on this dialect.  Recorded, not silently carried.
 */
export function buildReactionsModalTotalSource(
  adapters: readonly ReactionsModalVariantAdapter[],
): string {
  return `(() => {
  ${reactionsModalRootSource(adapters)}
  function __lhToTotal(raw) {
    const parsed = parseInt(String(raw).replace(/,/g, ''), 10);
    return isNaN(parsed) ? null : parsed;
  }

  const marked = document.querySelector('[data-lhremote-reactions]');
  if (marked) {
    const stamped = __lhToTotal(marked.getAttribute('data-lhremote-reactions-total') || '');
    if (stamped !== null) return stamped;
  }

  const root = __lhReactionsModalRoot();
  if (!root || root.ambiguousVariants) return 0;

  const text = (root.modal.textContent || '').replace(/\\s+/g, ' ');
  const inline = text.match(/(\\d[\\d,]*)\\s+reactions?/i);
  if (inline) {
    const parsed = __lhToTotal(inline[1]);
    if (parsed !== null) return parsed;
  }
  const all = text.match(/All\\s*\\(?\\s*(\\d[\\d,]*)\\s*\\)?/i);
  if (all) {
    const parsed = __lhToTotal(all[1]);
    if (parsed !== null) return parsed;
  }
  return 0;
})()`;
}

/**
 * Reactions-modal extraction source — the engager rows.
 *
 * Returns:
 *
 * - an ARRAY of engager records on success, empty included.  An empty array is
 *   a positive claim: the container resolved and held no rows, which the
 *   caller hands to the cardinal tier
 * - `null` when no adapter claimed the page, or when the claiming adapter
 *   resolved no modal root.  That IS the container tier, enforced
 *   structurally and upstream of any per-field check exactly as on post
 *   detail (ADR-008 § Decision 4): an adapter that cannot resolve its own
 *   region has not read it, and the caller raises
 * - `{ ambiguousVariants: [...] }` when two or more adapters claimed it
 *
 * The distinction between the first two is the point of this whole surface
 * being registered.  The code this replaces coalesced them — `scraped ?? []` —
 * so a modal nothing could resolve and a modal with nobody in it arrived at
 * the caller as the same value.
 *
 * ## What is shared, and why it is not per-dialect
 *
 * Everything below the modal root: row enumeration by profile link, the
 * de-duplication, the public-id parse, the name and headline reads, and the
 * reaction-type mapping.  Nothing about any of that has been measured to
 * differ between the dialects, and splitting an unmeasured read into two
 * copies is how one measurement becomes two that drift.  The dialects differ
 * in how the modal ROOT is found, and that is what `adapter.extract` carries
 * on this surface.
 *
 * The name and headline go through the same shared helpers post detail uses,
 * rather than through the bespoke scan this replaces.  That is a fix carried
 * across: the bespoke read took the first `span[dir="ltr"]` or
 * `span[aria-hidden="true"]` inside the link, which in the legacy dialect
 * wraps BOTH the visible copy of a name and its assistive-technology twin and
 * returns them concatenated (#836).
 */
export function buildReactionsModalExtractionSource(
  adapters: readonly ReactionsModalVariantAdapter[],
): string {
  return `(() => {
  ${extractionHelpersSource()}
  ${reactionsModalRootSource(adapters)}
  const root = __lhReactionsModalRoot();
  if (!root) return null;
  if (root.ambiguousVariants) return { ambiguousVariants: root.ambiguousVariants };
  const modal = root.modal;

  // Does this ancestor hold row content the link's own subtree does not?  The
  // row walk's accept predicate — see the comment at its call site for why the
  // signal is structural and why the exclusion is load-bearing.
  function __lhHoldsRowContent(el, link) {
    for (const node of el.querySelectorAll(${jsString(REACTIONS_MODAL_ROW_CONTENT)})) {
      if (!link.contains(node)) return true;
    }
    return false;
  }

  const engagers = [];
  const seen = new Set();

  for (const link of modal.querySelectorAll(${jsString(REACTIONS_MODAL_ENGAGER_LINK)})) {
    const href = (link.href || '').split('?')[0];
    if (seen.has(href)) continue;

    const idMatch = href.match(/\\/in\\/([^/?]+)/);
    const publicId = idMatch ? idMatch[1] : null;

    const name = __lhCleanName(__lhVisibleText(link)) || '';
    const nameParts = name.split(/\\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    if (!firstName) continue;
    // Recorded only now that the row yielded a usable name.  An actor lockup
    // renders the avatar anchor BEFORE the name-bearing one at the same href,
    // so claiming the de-dup slot before the reject would let the unreadable
    // half consume it and skip the readable sibling — every row yielding
    // nothing on a fully-rendered modal.
    seen.add(href);

    // The row this link belongs to.  \`li\` first, because a list item is the
    // shape a reactor list renders and it names the row outright.  It walks
    // from the PARENT, because \`closest\` includes the element it is called on
    // and a LinkedIn anchor always carries a class — so \`link.closest(...)\`
    // can return the link itself and scope the headline and pictogram reads to
    // its own subtree, where neither exists.
    //
    // What follows the \`li\` try is a STRUCTURAL WALK rather than a second
    // selector, and walking from the parent is why: \`from.closest('[class]')\`
    // returns the nearest classed ancestor OF THE ANCHOR, which on any dialect
    // nesting the link deeper than one level inside its row
    // (\`li > div.row > div.name-wrapper > a\`) is the name wrapper — an
    // intermediate element holding neither the headline nor the pictogram.
    // Both reads then come back empty, the row ships as
    // \`headline: null, engagementType: 'LIKE'\`, and \`extractedCount > 0\` means
    // no tier fires: the original reported symptom, one level up.
    //
    // So the walk accepts the first ancestor that actually HOLDS row content —
    // a headline candidate or a reaction pictogram that is NOT inside the
    // link's own subtree, the exclusion being what stops a name span wrapped
    // in the anchor from answering for the row.  A structural signal, never a
    // guessed class name: no SDUI row selector has been measured, and inventing
    // one is what this module refuses to do everywhere else.  Bounded three
    // ways — it never leaves the modal, it stops before the modal itself, and
    // it is depth-capped — and if it finds nothing it falls back to the
    // parent-relative \`closest('[class]')\` this replaces, so the measured
    // legacy path cannot regress.
    const from = link.parentElement;
    let entry = from ? from.closest('li') : null;
    if (!entry && from) {
      let ancestor = from;
      let depth = 0;
      while (
        ancestor &&
        ancestor !== modal &&
        modal.contains(ancestor) &&
        depth < ${String(REACTIONS_MODAL_ROW_WALK_DEPTH)}
      ) {
        if (__lhHoldsRowContent(ancestor, link)) { entry = ancestor; break; }
        ancestor = ancestor.parentElement;
        depth++;
      }
    }
    if (!entry && from) entry = from.closest('[class]');

    let headline = null;
    if (entry) {
      headline = __lhFirstHeadline(
        Array.from(entry.querySelectorAll('p, span')),
        name,
      );
    }

    // The reaction pictogram's alt text.  Mapped to the engagement vocabulary
    // this operation reports rather than to LinkedIn's own naming, and left
    // at LIKE when no pictogram is recognised — a reactor with an unreadable
    // icon still reacted.
    let engagementType = 'LIKE';
    if (entry) {
      for (const img of entry.querySelectorAll('img[alt]')) {
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        if (alt.includes('celebrate') || alt.includes('clap')) { engagementType = 'PRAISE'; break; }
        if (alt.includes('support') || alt.includes('care')) { engagementType = 'EMPATHY'; break; }
        if (alt.includes('love') || alt.includes('heart')) { engagementType = 'APPRECIATION'; break; }
        if (alt.includes('insightful') || alt.includes('light')) { engagementType = 'INTEREST'; break; }
        if (alt.includes('funny') || alt.includes('laugh')) { engagementType = 'ENTERTAINMENT'; break; }
        if (alt.includes('like') || alt.includes('thumb')) { engagementType = 'LIKE'; break; }
      }
    }

    engagers.push({
      firstName: firstName,
      lastName: lastName,
      publicId: publicId,
      headline: headline,
      engagementType: engagementType,
    });
  }

  return engagers;
})()`;
}

/**
 * Reactions-modal scroll source — advance the engager list by `distance` px.
 *
 * Returns:
 *
 * - `true` when the list actually moved
 * - `false` when it did not.  That is the ordinary reached-the-bottom signal
 *   and it must NOT be an error: the rows already scraped are a real
 *   observation, and the cardinal tier is what decides whether they are enough
 * - `null` when no adapter claimed the page, or when the claiming adapter
 *   resolved no modal root
 * - `{ ambiguousVariants: [...] }` when two or more adapters claimed it
 *
 * **The last two used to be `false` as well, and collapsing them there was the
 * defect.**  The doc that stood here justified the single refusal with *"a
 * refusal is how the collect loop learns it has reached the bottom"* — a
 * rationale that covers did-not-move and nothing else, silently extended to
 * could-not-resolve.  Those two conditions are exactly what
 * {@link buildReactionsModalExtractionSource} reports as `null` and as the
 * ambiguity record, and what the caller raises `DOMVariantUnsupportedError` /
 * `DOMVariantAmbiguousError` for — so the operation held two contrary readings
 * of one condition, and the scroll's was the one that swallowed it.  A modal
 * that re-renders into an unresolvable state mid-collection read as *the
 * bottom*, the loop broke, and the cardinal tier stayed quiet because rows
 * scraped before the re-render make `extractedCount` positive (#840).
 *
 * The refusal shape mirrors the extraction source's on purpose: the caller
 * classifies both with the same predicate and raises through the same
 * construction, which is what keeps this one contract rather than a second
 * copy of it.
 *
 * The distance is randomised by the caller rather than fixed, so a modal
 * scroll does not carry the detection signal of a perfectly uniform cadence.
 */
export function buildReactionsModalScrollSource(
  adapters: readonly ReactionsModalVariantAdapter[],
  distance: number,
): string {
  return `(() => {
  ${reactionsModalRootSource(adapters)}
  const root = __lhReactionsModalRoot();
  if (!root) return null;
  if (root.ambiguousVariants) return { ambiguousVariants: root.ambiguousVariants };
  const modal = root.modal;

  let scrollable = null;
  for (const div of modal.querySelectorAll('div')) {
    const style = getComputedStyle(div);
    if (
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      div.scrollHeight > div.clientHeight
    ) {
      scrollable = div;
      break;
    }
  }
  if (!scrollable) scrollable = modal;

  const prev = scrollable.scrollTop;
  scrollable.scrollTop += ${String(distance)};
  return scrollable.scrollTop > prev;
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
