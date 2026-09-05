// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import type { FeedPost } from "../types/feed.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { humanizedScrollY, humanizedScrollToByIndex, retryInteraction } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { delay as utilsDelay, gaussianDelay, gaussianBetween, maybeHesitate, maybeBreak, simulateReadingTime } from "../utils/delay.js";
import type { ConnectionOptions } from "./types.js";
import { navigateAwayIf } from "./navigate-away.js";
import { gateOnLoggedInState } from "./wait-for-logged-in-state.js";

/**
 * Input for the get-feed operation.
 */
export interface GetFeedInput extends ConnectionOptions {
  /** Number of posts per page (default: 10). */
  readonly count?: number | undefined;
  /** Cursor token from a previous get-feed call for the next page. */
  readonly cursor?: string | undefined;
  /** Optional humanized mouse for natural cursor movement and scrolling. */
  readonly mouse?: HumanizedMouse | null | undefined;
}

/**
 * Output from the get-feed operation.
 */
export interface GetFeedOutput {
  /** Feed posts for the current page. */
  readonly posts: FeedPost[];
  /** Cursor token for retrieving the next page, or null if no more pages. */
  readonly nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Raw post shape returned by the in-page scraping script
// ---------------------------------------------------------------------------

/** @internal Exported for reuse by search-posts. */
export interface RawDomPost {
  url: string | null;
  authorName: string | null;
  authorHeadline: string | null;
  authorProfileUrl: string | null;
  text: string | null;
  mediaType: string | null;
  reactionCount: number;
  commentCount: number;
  shareCount: number;
  timestamp: string | null;
}

// ---------------------------------------------------------------------------
// In-page DOM scraping script
// ---------------------------------------------------------------------------

/**
 * JavaScript source evaluated inside the LinkedIn page context via
 * `Runtime.evaluate`.  Returns an array of {@link RawDomPost} objects
 * (without URNs — those are extracted separately via the three-dot menu).
 *
 * ## Discovery strategy (2026-04 onwards)
 *
 * LinkedIn's SSR feed uses `div[data-testid="mainFeed"]` as the feed
 * list (`role="list"`) and `div[role="listitem"]` for each post.
 * CSS class names are obfuscated hashes (CSS Modules), so the script
 * relies on semantic attributes (`data-testid`, `aria-label`) and
 * structural position within author links.
 *
 * - **Post text**: `[data-testid="expandable-text-box"]` (clone, strip
 *   `expandable-text-button` child, take `textContent`).
 * - **Author anchor**: the last profile anchor inside the post's actor header
 *   — the region ending at the first of the control-menu button and the post
 *   body.  A mention or a suggested-connection link sits below that region; a
 *   repost chip sits inside it but above the actor's own block, so it is never
 *   the last.  An anchor's href and text alone cannot separate a chip that
 *   renders the way the actor block does, which is why the region bound, not
 *   the `[name, connection degree, headline, relative time]` run, is what
 *   decides here.
 * - **Author fields**: the visible copies that anchor renders, read as a FIELD
 *   SEQUENCE in document order — `[name, connection degree, headline, relative
 *   time]`, members optionally absent.  A field is a leaf `<p>`/`<span>` run of
 *   the anchor's outermost `aria-hidden="true"` wrappers, or of the anchor
 *   itself when it has none, so the screen-reader-only copy rendered beside
 *   each visible one is never mistaken for it.  Asking whether a run exists
 *   rather than which tag carries it is what serves the SDUI `<p>` dialect and
 *   the legacy `<span>` dialect from one rule; the three reads below are all
 *   taken off this one sequence.
 * - **Author name**: a leading PREFIX of that sequence, chosen by how well its
 *   folded letters prefix-match the anchor's OWN href slug.  The slug is a
 *   second *reading* of the single element both author fields come from — never
 *   a second source — so the name and the profile URL still cannot describe two
 *   people.  Wrapper membership alone cannot decide this: a name split across
 *   wrappers and a name sitting beside a badge in its own wrapper are
 *   structurally identical, so any rule reading only membership must get one of
 *   those two families wrong.  What the slug decides is deliberately narrow —
 *   how far the name extends from where the name STARTS, and whether a badge is
 *   glued onto it — never WHICH field is the name: candidates are prefixes of
 *   the leading fields that are neither a bare badge nor a bare relative time,
 *   so a role or brand slug (`/in/head-of-widgets/`) cannot promote the
 *   headline into the name slot.  Falsified by a slug the fields do not
 *   corroborate at all — an opaque one, or a transliterated non-Latin name —
 *   and there this read declines and the first name-bearing run is used
 *   instead, so the signal degrades rather than inventing.  A slug that merely
 *   omits part of the display name ("Ada Lovelace, PhD" under
 *   `/in/ada-lovelace/`) does NOT decline: it corroborates a prefix of the
 *   name's own field, and the whole field is returned.
 * - **Author profile URL**: `href` of that same author anchor.
 * - **Author headline**: the first field that is none of a relative time, a
 *   badge that is wholly a connection degree, the actor header's own chrome, or
 *   one of the fields the NAME was read out of — the last excluded by INDEX,
 *   using the span the name read already knows, never by testing a field's text
 *   against the name.  A content test cannot separate the name's own field from
 *   a headline that merely contains the name ("Ada Lovelace Consulting"), so it
 *   discarded both; the origin is not ambiguous that way.  A positional rule
 *   ("3rd `<p>`") cannot survive here either: the legacy and accessible shapes
 *   render many more runs, so a tag index means nothing across dialects.  The
 *   rule is one of EXCLUSION and has no positive test, so a token the
 *   classifiers fail to recognise is reported to the user as the headline —
 *   which is why they carry the same badge and relative-time vocabulary as this
 *   repository's other three extractors rather than a private subset.  Its
 *   accepted cost, measured rather than predicted: a token those classifiers do
 *   not know ("• Open to work") is emitted AS the headline.
 * - **The one shape the name read cannot decide.** A slug whose tail continues
 *   into the NEXT field, with no badge between them, is genuine evidence that
 *   the two fields are one name — and it is also what an eponymous business
 *   renders.  `/in/ada-lovelace-consulting/` over "Ada Lovelace" then
 *   "Consulting" fuses both and leaves the headline null.  This is left fused
 *   deliberately: two runs reading "Ada Lovelace" / "Consulting" are
 *   structurally identical to a display name split across two runs, which is
 *   the very shape #860 asks to fuse, and the slug is the only extra evidence
 *   there is.  What is NOT left fused is the case where the second field
 *   carries real text the slug does not account for ("Photography & Video"
 *   under `/in/john-smith-photography/`) — see `MAX_NAME_TAIL`, which bounds
 *   how much uncorroborated text may cross a field boundary.  The falsifier for
 *   the residue is a feed capture showing an eponymous slug whose business
 *   suffix is a single fully-corroborated word; this repository holds no feed
 *   capture at all (#897), so the bound is set from what a display name's own
 *   honorific suffixes cost, not from any observed headline.
 * - **Timestamp**: the last field opening with `\d+mo` or `\d+[smhdw]`.  Null
 *   when the anchor carries no time field at all, which on some post shapes is
 *   the truth rather than a miss — LinkedIn renders it outside the anchor there.
 *
 * Post URNs are NOT available in the DOM.  They are extracted in a
 * separate phase by opening each post's three-dot menu, clicking
 * "Copy link to post", and deriving the URN from the captured URL.
 */
const SCRAPE_FEED_POSTS_SCRIPT = `(() => {
  const posts = [];
  if (window.__lhrNextIdx == null) window.__lhrNextIdx = 0;

  // --- Author anchor helpers ---
  // The author name and the author profile URL are read from ONE anchor, so
  // they can never describe two different people.  These helpers use nothing
  // but an anchor's href and its own text content, which every DOM dialect
  // shares, so the read does not depend on any dialect-specific marker.

  // Profile anchors inside a post, in document order.
  function profileLinksIn(item) {
    return Array.from(item.querySelectorAll('a[href*="/in/"], a[href*="/company/"]'));
  }

  // The same profile anchors PLUS the two elements that close the post's actor
  // header: the control-menu button and the post body.  Queried together in one
  // call, because a single \`querySelectorAll\` returns nodes in document order
  // by spec — so the boundary is the anchors' real position relative to those
  // markers rather than an assumption about the markup's shape.
  const HEADER_SCAN_SELECTOR =
    'a[href*="/in/"], a[href*="/company/"], ' +
    'button[aria-label^="Open control menu for post"], ' +
    '[data-testid="expandable-text-box"]';

  // The profile anchors rendered inside the post's actor header — those before
  // the FIRST of the control-menu button and the post body.  Both markers are
  // already load-bearing here (post detection and text extraction), so bounding
  // the region adds no new dialect dependency; taking whichever comes first is
  // what makes the bound hold whichever order LinkedIn serves them in.
  //
  // Returns an empty list when the region is empty OR when neither marker is
  // present at all — both mean "this signal has nothing to say", and the caller
  // falls back.  Returning every link in the post instead would not restore the
  // previous behaviour, it would invent a third one: the cascade below this
  // region is first-wins, so handing it an unbounded list to resolve last-wins
  // would select mentions and embedded actors by construction.
  function headerLinksIn(item, links) {
    const ordered = Array.from(item.querySelectorAll(HEADER_SCAN_SELECTOR));
    const boundary = ordered.findIndex(function (node) {
      return links.indexOf(node) < 0;
    });
    return boundary < 0 ? [] : ordered.slice(0, boundary);
  }

  // The last element of a list satisfying a predicate, or null.
  function lastWhere(list, pred) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (pred(list[i])) return list[i];
    }
    return null;
  }

  // Path part of an anchor's href, or null when it cannot be parsed.
  function linkPath(a) {
    try {
      return new URL(a.href).pathname;
    } catch (err) {
      return null;
    }
  }

  function hasVisibleText(a) {
    return (a.textContent || '').trim().length > 0;
  }

  // A relative-time token — "18h", "3d", "45m", "1mo", "1y", "2yr" — followed
  // by the separator LinkedIn renders after it, or by the end of the run.  The
  // same token vocabulary the timestamp read below uses, and that parity is
  // load-bearing rather than decorative: this is the FIRST signal of the
  // whole-post fallback, so a token it cannot see is a post whose author gets
  // chosen by document order instead — which selects a decoy that renders a
  // name run ahead of the real author.  Widened with \`FIELD_TIMESTAMP\`,
  // \`TRAILING_BADGE\` and \`parseTimestamp\`; the four are one vocabulary, and
  // three of four is how the out-of-network badge went missing.
  //
  // \`mo\` and the year forms precede \`[smhdw]\` for the reason
  // \`FIELD_TIMESTAMP\` gives: \`m\` is in \`[smhdw]\`, so the shorter branch
  // claims \`1mo\`'s \`1m\` and then fails the separator guard on the \`o\`.
  //
  // Unanchored because it is tested against an anchor's whole concatenated text
  // rather than one trimmed <p>.
  const RELATIVE_TIME_IN_TEXT = /(?:\\d+mo|\\d+yr|\\d+y|\\d+[smhdw])(?:\\s|[\\u2022\\u00B7]|$)/;

  // Text carrying no letter and no digit is decoration — a separator bullet, an
  // icon glyph — and is never a name.
  const NAME_LIKE = /[\\p{L}\\p{N}]/u;

  // Where inside an anchor the name a reader sees is rendered.  LinkedIn writes
  // the name twice: the visible copy wrapped in \`aria-hidden="true"\`, and a
  // screen-reader-only copy beside it that reads "View <name>'s profile" or
  // repeats the name with the connection degree appended.  Either may come
  // first in document order, so position cannot tell them apart — the wrapper
  // can.
  //
  // An anchor often carries several wrappers, one per field: the name, then the
  // connection degree, the headline, the timestamp, sometimes the avatar's
  // initials.  Outermost wrappers only, so a nested one is not considered
  // twice, and decoration-only wrappers are dropped so a separator bullet can
  // never become the name.
  function hiddenWrappers(a) {
    const parts = [];
    for (const node of Array.from(a.querySelectorAll('[aria-hidden="true"]'))) {
      const txt = (node.textContent || '').trim();
      if (!txt || !NAME_LIKE.test(txt)) continue;
      if (parts.some(function (p) { return p.contains(node); })) continue;
      parts.push(node);
    }
    return parts;
  }

  // The single wrapper the name-run heuristic bets on: the first rendering a
  // run, on the reasoning that a badge or a set of initials is bare text in its
  // wrapper.  That is an assumption about markup rather than a property of it,
  // and issue #860 measured it inverting — a wrapper holding ONLY a badge run
  // beside a name rendered as bare text returns "2nd" as the name.  It survives
  // as the FALLBACK for \`anchorName\`, used when the href carries no usable
  // signal; \`fieldRoots\` below is what the primary read uses instead.
  function visibleRoot(a) {
    const parts = hiddenWrappers(a);
    return parts.find(hasNameRun) || parts[0] || a;
  }

  // Every part of the anchor holding a visible copy, considered JOINTLY.
  //
  // Which wrapper holds the name is not decidable from wrapper membership: a
  // name SPLIT ACROSS wrappers and a name sitting BESIDE A BADGE in its own
  // wrapper are the same shape structurally, so a rule reading only membership
  // can choose which of the two families to serve and must get the other wrong.
  // Issue #860 is that pair.  What separates them is evidence from OUTSIDE the
  // wrappers, which \`slugName\` supplies.
  //
  // Falls back to the anchor itself when no wrapper qualifies — the legacy
  // dialect's whole shape, and the decoration-only-wrapper case with it.
  function fieldRoots(a) {
    const parts = hiddenWrappers(a);
    return parts.length > 0 ? parts : [a];
  }

  // The name runs an element renders: <p> in the SDUI shape, <span> in the
  // legacy one.  Asking only WHETHER a run exists — never which tag carries it
  // — is what keeps every read below dialect-agnostic.  One selector list, not
  // two queries concatenated: the callers below take the FIRST run, and two
  // queries would order every <p> ahead of every <span> rather than in document
  // order, so a headline could outrank a name an anchor renders before it.
  const RUN_SELECTOR = 'p, span';

  function nameRuns(root) {
    return Array.from(root.querySelectorAll(RUN_SELECTOR));
  }

  // Does this element render a run beneath it?  Short-circuits on the first
  // match, where \`nameRuns(node).length === 0\` materialises every descendant
  // run only to ask whether the list is empty.  Reads RUN_SELECTOR rather than
  // repeating the list: extraction drifting from selection is the defect #898
  // records, and a second copy of the selector is where that drift starts.
  function hasRun(root) {
    return root.querySelector(RUN_SELECTOR) !== null;
  }

  // Does the anchor render its name inside a run, rather than as bare link text?
  function hasNameRun(a) {
    return nameRuns(a).some(function (node) {
      return NAME_LIKE.test((node.textContent || '').trim());
    });
  }

  // Is this anchor's profile linked more than once inside the post?  LinkedIn
  // usually links the author twice — once for the avatar, once for the name
  // block — while chips and mentions are linked once.
  function isPairedIn(links) {
    return function (a) {
      const path = linkPath(a);
      if (path === null) return false;
      return links.filter(function (other) { return linkPath(other) === path; }).length > 1;
    };
  }

  // The author among the anchors of the post's actor header.
  //
  // Inside that region POSITION is evidence, which it is nowhere else: every
  // decoy the region still admits — a repost chip, an "X commented on this"
  // chip — renders BEFORE the actor's own block, never after it.  So each
  // signal takes the LAST anchor it admits rather than the first.
  //
  //   1. The author's profile is linked twice (avatar + name block); a chip is
  //      linked once.
  //   2. Failing that, the actor block renders its name inside a run where a
  //      chip may be bare text.
  //   3. Failing that, position alone: the last anchor carrying any text.
  //
  // Signal 1 counts multiplicity WITHIN the region, never across the whole post.
  // Both of the author's anchors — avatar and name block — are inside the actor
  // header, so the region loses nothing by being the corpus; counting across the
  // post instead lets a chip win on evidence drawn from outside the region it is
  // being ranked in.  A resharer who is also mentioned in the post's own body is
  // linked twice that way, and would outrank a singly-linked author.
  //
  // The relative-time signal is deliberately NOT consulted here.  It is a proxy
  // for "this is the actor block", and inside the header the region bound plus
  // position answer that question directly — while the proxy misfires outright
  // on a decoy whose own bare text ends in a time-like token ("Deco Yperson 2d"),
  // which is one of the shapes issue #859 measured.  It stays in the fallback
  // below, where there is no positional evidence to replace it.
  function pickHeaderAuthor(candidates) {
    const named = candidates.filter(hasVisibleText);
    if (named.length === 0) return null;
    return lastWhere(named, isPairedIn(candidates))
      || lastWhere(named, hasNameRun)
      || named[named.length - 1];
  }

  // The post's AUTHOR anchor — not merely a profile anchor.  Reading both
  // fields off one element makes them agree; picking the right element is what
  // makes them agree about the right person, and any profile link rendered
  // before the author's (a mention, a repost chip, a suggested connection) is a
  // candidate for being mistaken for it.
  //
  // An anchor's href and its own text are not enough on their own: a repost
  // chip that renders its name exactly the way the actor block does is
  // indistinguishable on those two inputs (issue #859).  The third input is
  // WHERE the anchor sits — inside the actor header or below it — which
  // \`headerLinksIn\` bounds using markers this script already depends on.
  //
  // So: prefer the actor header's own answer; fall back to the whole post only
  // when the header holds no text-bearing anchor at all, and there use the
  // original cascade unchanged, first-wins:
  //
  //   1. The anchor whose own text carries the [name, connection degree,
  //      headline, relative time] run this file's DOM notes describe.  The run
  //      is recognised by its time token, read off the anchor's text rather
  //      than off whichever element holds it, so both name shapes satisfy it.
  //   2. Failing that, the profile linked more than once.
  //   3. Failing that, the anchor wrapping its name in a run.
  //   4. Then the first anchor carrying any text, and finally the first anchor
  //      at all, so a post with only a text-less or empty author link still
  //      yields a URL rather than nothing.
  //
  // A quote-repost — a reshare carrying its own commentary — resolves correctly
  // out of this: the outer post has a body of its own, so the region closes on
  // it and the embedded original's actor anchors fall outside; the outer
  // resharer, who authored that commentary, is selected, and that is also who
  // LinkedIn's own control-menu label names.  A BARE reshare carries no
  // commentary and so no body of its own, and there the region closes on the
  // embedded original's body instead and the original author is selected —
  // which is the right answer for that shape, and the one issue #859's own
  // reproductions ask for.
  function findAuthorAnchor(item) {
    const links = profileLinksIn(item);
    if (links.length === 0) return null;

    const header = pickHeaderAuthor(headerLinksIn(item, links));
    if (header) return header;

    const named = links.filter(hasVisibleText);

    const dated = named.find(function (a) {
      return RELATIVE_TIME_IN_TEXT.test(a.textContent || '');
    });
    if (dated) return dated;

    const paired = named.find(isPairedIn(links));
    if (paired) return paired;

    return named.find(hasNameRun) || named[0] || links[0] || null;
  }

  // The visible name an anchor renders: the first run carrying a name inside
  // whichever part of the anchor holds the visible copy, or that part's own
  // bare text when it renders no run at all.
  function anchorName(a) {
    const root = visibleRoot(a);
    for (const node of nameRuns(root)) {
      const txt = (node.textContent || '').trim();
      if (txt && NAME_LIKE.test(txt)) return txt;
    }
    const bare = (root.textContent || '').trim();
    return bare && NAME_LIKE.test(bare) ? bare : null;
  }

  // The runs of \`root\` that hold no further run — the leaves of the run tree.
  // A field's text lives on a leaf; an ancestor run's \`textContent\` is every
  // field beneath it concatenated, which is how neighbouring fields fuse.
  function leafRuns(root) {
    return nameRuns(root).filter(function (node) {
      return !hasRun(node);
    });
  }

  // The anchor's rendered fields, in document order.  In every dialect this is
  // [name, connection degree, headline, relative time] with members optionally
  // absent: the legacy shape renders them as <span> runs, the SDUI shape as <p>
  // runs, and this reads both because \`nameRuns\` asks only WHETHER a run
  // exists, never which tag carries it.
  //
  // A root contributes its own bare text when it produced NO field — not merely
  // when it renders no run.  A wrapper can render runs that are all EMPTY: the
  // one real actor-header capture in this repository,
  // \`linkedin/__fixtures__/legacy/post-with-comments.html\`, wraps two
  // whitespace-only \`white-space-pre\` spans and an <svg> around a bare
  // "• Adi", and those spans ARE leaves — so a rescue gated on "renders no
  // run" never fires and the wrapper yields nothing at all.  Gating on
  // "produced no field" is what lets the bare-text branch reach that shape.  On
  // that capture the lost field is the connection degree, which is harmless;
  // the identical construction around a name or a headline loses it silently.
  function anchorFields(a) {
    const fields = [];
    for (const root of fieldRoots(a)) {
      const before = fields.length;
      for (const leaf of leafRuns(root)) {
        const txt = (leaf.textContent || '').trim();
        if (txt && NAME_LIKE.test(txt)) fields.push(txt);
      }
      if (fields.length === before) {
        const bare = (root.textContent || '').trim();
        if (bare && NAME_LIKE.test(bare)) fields.push(bare);
      }
    }
    return fields;
  }

  // --- Field classifiers ---
  //
  // Neither vocabulary is invented here.  The sibling post-detail extractors
  // \`linkedin/dom-variant.ts\` and \`operations/get-post.ts\` each carry
  // \`(?:1st|2nd|3rd|Out of network|You)\` for the connection degree and
  // \`[1-9]\\d*mo\` for the
  // relative time, and \`parseTimestamp\` further down THIS file accepts \`Nmo\`
  // ("LinkedIn emits \`Nmo\` for posts ~30-330 days old").  Before this change the
  // feed extractor was the only one of the four that could not classify a token
  // its own downstream parser expects.

  // A field the WHOLE of which is a connection badge.  Anchored at both ends on
  // purpose: a genuine headline that merely STARTS with an ordinal ("1st Officer
  // at Acme") is a headline, not a degree.
  //
  // \`You\` occupies the degree position on the logged-in account's own posts.
  // Without it, every post the account authored emitted "• You" as the
  // HEADLINE, because the headline is chosen by exclusion and nothing else
  // excluded it.
  const DEGREE_ONLY = /^[\\s\\u2022\\u00B7]*(?:\\d+(?:st|nd|rd|th)\\+?|Out of network|You)[\\s\\u2022\\u00B7]*$/;

  // The rest of the actor header's chrome, matched the same way: anchored at
  // both ends, so a genuine headline that merely CONTAINS one of these words
  // ("Following the Money at Acme", "Premium Support Lead") is a headline.
  //
  // The headline is chosen by EXCLUSION and has no positive test of its own, so
  // every token these classifiers fail to recognise is emitted to the user AS
  // the headline.  \`DEGREE_ONLY\` above covered the ordinals and \`You\` and
  // nothing else, which is why "• Following" — the ordinary follow-state token
  // in a COMPANY actor header — displaced the real headline rather than being
  // skipped.
  //
  // The degree half widens toward the vocabulary this repository already
  // carries for the same position: \`linkedin/dom-variant.ts\` and
  // \`operations/get-post.ts\` both spell it
  // \`(?:1st|2nd|3rd|Out of network|You)\` -- all four of their sites carry
  // \`Out of network\`, which this file omitted while its own comment quoted the
  // vocabulary WITHOUT it, so the claim of parity read as met.  A field of
  // \`"* Out of network"\` matched neither classifier and, because the headline
  // rule chooses by exclusion, was emitted AS the headline.  The
  // unabbreviated form ("1st degree connection") is the accessible rendering of
  // that same field, which neither of those two extractors meets and this one
  // does.
  const HEADER_CHROME = /^[\\s\\u2022\\u00B7+]*(?:Following|Follow|Premium|Promoted|\\d+(?:st|nd|rd|th)\\+?\\s+degree\\s+connection)[\\s\\u2022\\u00B7]*$/;

  // The relative-time token a field opens with, as the timestamp read below
  // reports it.  Anchored, so a screen-reader string ("18 hours ago") is not a
  // timestamp.  \`mo\` is tried BEFORE \`[smhdw]\` for the reason \`parseTimestamp\`
  // gives for its own alternation: \`m\` is in \`[smhdw]\`, so the shorter branch
  // matches the "1m" of "1mo" and then fails on the "o" — which is how "1mo •"
  // used to be classified as neither a timestamp nor a degree, and so became the
  // headline.
  const FIELD_TIMESTAMP = /^(\\d+mo|\\d+yr|\\d+y|\\d+[smhdw])(?:\\s|[\\u2022\\u00B7]|$)/;

  // Trailing tokens a display name never ends with.  Trimming these is the ONLY
  // way a name candidate may end INSIDE a field — which is precisely what stops
  // "Ada Lovelace, PhD" being shortened to "Ada Lovelace" when the slug is
  // /in/ada-lovelace/: ", PhD" is words, not a badge, so there is no candidate
  // that ends there.
  const TRAILING_BADGE = /[\\s\\u2022\\u00B7]*(?:\\d+(?:st|nd|rd|th)\\+?|Out of network|You|\\d+mo|\\d+yr|\\d+y|\\d+[smhdw])[\\s\\u2022\\u00B7]*$/;
  const TRAILING_DECORATION = /[\\s\\u2022\\u00B7]+$/;

  // How many LEADING fields a name may span.  The shape this bounds is a name
  // split one word per wrapper ("Mary" / "Jane" / "Watson"); the cap keeps a
  // pathological anchor from making the candidate set large.
  const MAX_NAME_FIELDS = 4;

  // The shortest shared prefix that is evidence rather than coincidence — for a
  // slug long enough to have one.  Read it together with the \`Math.min\` at the
  // acceptance test in \`slugName\`: the bar is \`min(MIN_SLUG_MATCH, target.length)\`,
  // so a slug SHORTER than this stays usable exactly when a candidate explains it
  // in FULL.  /company/ibm/ against "IBM" scores 3 and is accepted; an absolute
  // floor of 4 could never be cleared by ANY 3-character slug, which permanently
  // excluded /company/ge/, /company/hp/, /company/sap/ and /in/ada/ from the
  // mechanism.  The comparison is \`<\`, so a score of exactly MIN_SLUG_MATCH is
  // ACCEPTED, not rejected.
  const MIN_SLUG_MATCH = 4;

  // How much UNCORROBORATED text a candidate may carry once it reaches past the
  // FIRST field.  Inside one field the slug is the only evidence there is and
  // the score below arbitrates; crossing a field boundary is different, because
  // the boundary is itself evidence that LinkedIn considers the two things
  // separate.  A second field therefore has to be nearly all slug to be read as
  // part of the name.
  //
  // Without this, /in/john-smith-photography/ over the fields "John Smith" then
  // "Photography & Video" scored the two-field candidate 20 - 5 = 15 against
  // "John Smith"'s 9 and returned "John Smith Photography & Video" -- the
  // eponymous-business slug, which is common, and a regression against the read
  // that shipped before #860.  The bound is what separates that from the split
  // name it otherwise looks exactly like: "John" then "Smith Jr" under
  // /in/john-smith/ leaves only "jr" uncorroborated and is still fused.
  //
  // Sized to the honorific suffixes a display name actually carries -- Jr, Sr,
  // II, III, MD, PhD, MBA -- and NOT to any observed headline, so a headline
  // short enough to slip under it fuses anyway.  That residue is the accepted
  // cost recorded in this file's header.
  const MAX_NAME_TAIL = 3;

  // Fold text and slug to one comparable form: NFD-normalise, drop combining
  // marks, lowercase, and remove everything that is not ASCII alphanumeric.
  // "Ada Lovelace" and "ada-lovelace" both become "adalovelace"; "Renée"
  // matches "renee".  A name in a non-Latin script folds to the empty string,
  // which scores zero and routes to the fallback — the honest answer, since
  // LinkedIn transliterates such slugs and the two are not comparable here.
  //
  // The mark strip matches \\p{M}, not the U+0300-U+036F block alone, so it
  // covers every combining mark NFD can emit rather than the basic subset.
  // No input's result depends on that today — the trailing ASCII-alphanumeric
  // filter drops combining marks whatever their block, and the two forms were
  // measured byte-identical — so the strip is the step the fold is documented
  // on, and the one that stays correct if that filter is ever widened past
  // ASCII to admit a non-Latin slug.
  function squash(s) {
    return s.normalize('NFD').replace(/\\p{M}/gu, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // The profile slug an anchor's href carries: the segment after /in/ or
  // /company/, the two forms every anchor considered here is selected by.
  // Taking the last path segment instead would read "recent-activity" off a
  // deep link.
  function anchorSlug(a) {
    const path = linkPath(a);
    if (path === null) return null;
    const parts = path.split('/').filter(function (p) { return p.length > 0; });
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i] === 'in' || parts[i] === 'company') return parts[i + 1];
    }
    return null;
  }

  function commonPrefixLen(x, y) {
    const n = Math.min(x.length, y.length);
    let i = 0;
    while (i < n && x.charCodeAt(i) === y.charCodeAt(i)) i++;
    return i;
  }

  // The maximal LEADING run of fields that are neither a bare connection badge
  // nor a bare relative-time field: where the name is, and the only place a name
  // candidate is allowed to start.
  //
  // In [name, degree, headline, time] the region is just [name].  In the split
  // family it is every fragment of the name.  Where no badge separates the name
  // from the headline it also takes in the headline — which the score in
  // \`slugName\` then rejects, because the slug does not corroborate it.
  function nameRegion(fields) {
    let end = 0;
    while (end < fields.length &&
           !DEGREE_ONLY.test(fields[end]) &&
           !FIELD_TIMESTAMP.test(fields[end])) {
      end++;
    }
    return fields.slice(0, end);
  }

  // The end offset of \`source.slice(0, end)\` with trailing badge, relative-time
  // and decoration tokens removed, repeatedly.  Returns \`end\` unchanged when
  // there is nothing to remove, and never trims a candidate that is ENTIRELY a
  // badge down to nothing.
  function trimTrailingBadge(source, end) {
    let cut = end;
    for (let guard = 0; guard <= MAX_NAME_FIELDS + 1; guard++) {
      const badge = TRAILING_BADGE.exec(source.slice(0, cut));
      if (badge === null || badge.index === 0) break;
      cut = badge.index;
    }
    const decoration = TRAILING_DECORATION.exec(source.slice(0, cut));
    if (decoration !== null && decoration.index > 0) cut = decoration.index;
    return cut;
  }

  // The name, disambiguated by the anchor's OWN href (issue #860).
  //
  // The slug already encodes the name, and it is a property of the SAME element
  // both author fields are read from — so consulting it cannot make name and
  // profile URL describe two people, which is the invariant issue #825 bought
  // and #825's AC-2 still pins.  It is not a second SOURCE; it is a second
  // reading of the one source.
  //
  // The slug's job is deliberately NARROW: it decides how far the name extends
  // from where the name STARTS, and whether a badge is glued onto it.  It does
  // not get to choose WHICH field is the name.  Candidates are therefore
  // PREFIXES of the name region, so a candidate always begins at the name's own
  // position.  Searching every window across all fields instead let a role,
  // brand or nickname slug — /in/head-of-widgets/, /in/thegrowthguy/,
  // /in/coach-mike/ — match the HEADLINE better than the real name, and the two
  // swapped places.
  //
  // Compare SQUASHED PREFIXES rather than whole strings: one rule then absorbs
  // both LinkedIn's trailing disambiguation hash (/in/john-smith-1a2b3c/ still
  // matches "John Smith") and separator-less slugs (/in/alexeypelykh/ matches
  // "Alexey Pelykh").
  //
  // Score = the characters of a candidate the slug CORROBORATES, minus those it
  // does not.  Subtracting, rather than using the uncorroborated tail only as a
  // tie-break, is what stops a badge paying for itself: against
  // /in/john-smith-1a2b3c/ the candidate "John Smith · 1st" shares one
  // character MORE than "John Smith" does — the hash's leading "1" meeting the
  // degree's — so on longest-prefix alone the badge-contaminated candidate wins,
  // which is #860's own bug re-created inside the fix for it.
  //
  // Returns null — deliberately, not a guess — when no candidate clears the bar;
  // the caller falls back to \`anchorName\`.  On success it returns the name AND
  // how many fields that name was read from, which is what lets the headline be
  // chosen by ORIGIN rather than by a content test (see \`nameFieldSpan\`).
  function slugName(a, fields) {
    const slug = anchorSlug(a);
    if (slug === null) return null;
    const target = squash(slug);
    if (target.length === 0) return null;

    const region = nameRegion(fields);
    if (region.length === 0) return null;

    // The region joined ONCE, so every candidate below is a slice of a single
    // string: "Jean-Luc Picard" must come back carrying its hyphen, which
    // rebuilding a candidate out of its words would lose.
    let source = '';
    const ends = [];
    const span = Math.min(region.length, MAX_NAME_FIELDS);
    for (let k = 0; k < span; k++) {
      source += (k === 0 ? '' : ' ') + region[k];
      ends.push(source.length);
    }

    let best = null;
    function consider(end) {
      if (end <= 0) return;
      const candidate = source.slice(0, end);
      if (!NAME_LIKE.test(candidate)) return;
      const folded = squash(candidate);
      const common = commonPrefixLen(folded, target);
      const excess = folded.length - common;

      // Crossing a field boundary costs more than the score alone charges for:
      // the boundary is LinkedIn's own statement that these are separate
      // things, so a multi-field candidate must be corroborated nearly in full.
      if (ends.length > 0 && end > ends[0] && excess > MAX_NAME_TAIL) return;

      const score = common - excess;
      if (best === null || score > best.score ||
          (score === best.score && common > best.common) ||
          (score === best.score && common === best.common && end < best.end)) {
        best = { end: end, common: common, score: score };
      }
    }

    for (const end of ends) {
      consider(end);
      const trimmed = trimTrailingBadge(source, end);
      if (trimmed !== end) consider(trimmed);
    }

    if (best === null || best.common < Math.min(MIN_SLUG_MATCH, target.length)) {
      return null;
    }

    // How many FIELDS the accepted candidate consumed.  \`best.end\` is an offset
    // into the joined region and may land INSIDE a field rather than on its
    // boundary — the fused "Ada Lovelace · 1st" case, where the cut falls before
    // the badge — so the field the cut lands in counts as consumed as well.
    let consumed = 1;
    for (let k = 0; k < ends.length; k++) {
      if (ends[k] < best.end) consumed = k + 2;
    }
    return { name: source.slice(0, best.end), fields: consumed };
  }

  // Does \`haystack\` carry \`needle\` as a whole PHRASE — bounded at both ends by
  // something that is neither a letter nor a digit?  The boundary is what keeps
  // a short name from swallowing an unrelated headline: "Ada" occurs inside
  // "Adaptive Systems Lead", and without the guard that headline would be
  // discarded as the name's own field and the post would report none at all.
  //
  // That boundary is DEFENSIVE at the single call site this currently has.
  // Replacing the whole function with a bare \`indexOf\` was measured against the
  // suite and changed no verdict, because \`nameFieldSpan\` reaches it only on
  // the decline path, where \`name\` came from \`anchorName\` — the FIRST name-like
  // run — so the loop matches at that same field whether or not the ends are
  // bounded, and no earlier field exists for a substring to hit first.  Kept,
  // because the guard costs nothing and a second caller would reach it; stated,
  // so nobody reads the suite's green as evidence the boundary is exercised.
  function phraseContains(haystack, needle) {
    if (needle.length === 0) return false;
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) return false;
      const before = at > 0 ? haystack.charAt(at - 1) : '';
      const after = haystack.charAt(at + needle.length);
      if (!NAME_LIKE.test(before) && !NAME_LIKE.test(after)) return true;
      from = at + 1;
    }
  }

  // WHICH fields the name was read from, as a half-open [from, to) range of
  // indices.  They are the only fields the headline may not be chosen from, and
  // the suppression is by ORIGIN rather than by content.
  //
  // The previous rule tested every field for phrase containment against the
  // resolved name, in both directions.  That drops the name's own field in both
  // of #860's families — the contaminated "Ada Lovelace · 1st", and the
  // fragments "Ada" / "Multi" of a name split across wrappers — but it also
  // drops a GENUINE headline that happens to contain the name, which on
  // LinkedIn is a whole class and not a corner: eponymous consultancies ("Ada
  // Lovelace Consulting"), "Founder at Ada Lovelace Studio", and the
  // "Name | Role" pattern.  A four-field actor header returned each of those
  // before that rule and null after it.
  //
  // No content test is needed, because the origin is already known.  When the
  // slug-scored read produced the name it consumed a known PREFIX of the name
  // region, and that prefix IS the span.
  //
  // When it DECLINED, the origin is known only for the one field \`anchorName\`
  // answered from — and excluding just that field emits the name's REMAINING
  // fragments as the headline.  A split name under an uncorroborating slug
  // ([Ada, Multi, • 1st]) reported "Multi", and a non-Latin name under its
  // transliterated slug ([Олексій, Пелих, • 1st, ...]) reported the person's
  // SURNAME as their headline while displacing the real one.  Both are the
  // fallback INVENTING a headline out of the very fragments the decline had
  // just admitted it could not delimit, and the second contradicts \`squash\`'s
  // own claim that folding to empty "routes to the fallback — the honest
  // answer": the name read fell back, and the headline read did not.
  //
  // So on the decline path the leading name REGION is withheld from the
  // headline, not merely the one field — but ONLY when a connection badge
  // TERMINATES that region.  The badge is LinkedIn's own statement that the
  // name ended there, and it is the sole structural evidence available once the
  // slug has declined; \`nameRegion\` is built on the same fact.  Everything
  // before it is therefore name-side, and withholding all of it yields null
  // where nothing follows the badge and the field AFTER the badge otherwise,
  // which is the real headline in every shape that renders one.
  //
  // Where the region is terminated by the TIMESTAMP instead — a company actor
  // header, which carries no connection degree at all ([Acme Corp, Head of
  // Widgets, 18h]) — no such statement exists, the region legitimately spans
  // name AND headline, and withholding it would drop a real headline.  That
  // shape keeps the single found field, which is what it read correctly before.
  //
  // \`Math.max\` keeps the found field excluded when the region does not reach it
  // — the badge-leading shape ([• 2nd, John Smith, ...]) has an EMPTY region,
  // because \`nameRegion\` stops at field 0, and its name sits at index 1.
  //
  // The residue is a split name under a declining slug with NO badge after it
  // ([Ada, Multi, 18h]), which still reports "Multi".  That is left deliberately
  // rather than missed: it is field-for-field identical to the company shape
  // above, so no rule can serve both, and #860's premise is that the text alone
  // cannot settle it.  Pinned as an accepted cost rather than left as prose.
  //
  // Accepted and pre-existing: where a leading screen-reader copy is itself the
  // field the name is read from, the excluded field is that copy and the real
  // name field becomes the headline.  The pre-#860 read behaves the same way,
  // and the accessible shape LinkedIn actually serves puts that copy beside an
  // \`aria-hidden\` sibling, which \`hiddenWrappers\` already resolves.
  function nameFieldSpan(scored, name, fields) {
    const regionEnd = nameRegion(fields).length;
    const badgeEnds = regionEnd < fields.length && DEGREE_ONLY.test(fields[regionEnd]);
    // The accept path needs the same widening, because ACCEPTING is not the
    // same as consuming the whole name.  A candidate that explains the slug on
    // a PREFIX of a split name is accepted at that prefix and stops there:
    // "Ada Lovelace" under the short slug /in/ada/ scores 3 against a bar of
    // \`min(4, 3)\`, so the read accepts "Ada" and consumed ONE field, leaving
    // "Lovelace" to win the headline race.  A Latin given name beside a
    // non-Latin surname does the same thing for a different reason — the
    // surname folds away to nothing, so extending over it neither gains nor
    // costs score and the shorter candidate holds the tie.
    //
    // Both are the accept-path form of the decline-path defect above, and they
    // are NOT reached by its tests: a wholly non-Latin name folds to empty,
    // scores zero and declines, so only a MIXED-script or short-slug name takes
    // this branch.  Keying both branches on the same badge is what makes the
    // rule one rule rather than two that can drift apart.
    if (scored !== null) {
      return { from: 0, to: badgeEnds ? Math.max(scored.fields, regionEnd) : scored.fields };
    }
    if (name === null) return { from: 0, to: 0 };
    for (let i = 0; i < fields.length; i++) {
      if (phraseContains(fields[i], name)) {
        return { from: i, to: badgeEnds ? Math.max(i + 1, regionEnd) : i + 1 };
      }
    }
    return { from: 0, to: 0 };
  }
  // --- Step 1: Find the feed list via data-testid ---
  const feedList = document.querySelector('[data-testid="mainFeed"]');
  if (!feedList) return posts;

  // --- Step 2: Iterate listitem children ---
  const items = feedList.querySelectorAll('div[role="listitem"]');
  for (const wrapper of items) {
    // The listitem wraps the actual post content in nested divs.
    // Some listitems may be zero-height (virtualized/hidden) or
    // non-post items (composer, suggestions).
    const item = wrapper;
    if (item.offsetHeight < 100) continue;

    // Detect real posts: must have a three-dot menu button
    const menuBtn = item.querySelector('button[aria-label^="Open control menu for post"]');
    if (!menuBtn) continue;

    // --- Discovery tagging ---
    // Tag each listitem with a unique index on first discovery so that
    // posts can be accumulated across scroll iterations despite LinkedIn
    // virtualising off-screen items out of the DOM.  The index value
    // itself isn't consumed by the Node-side logic — it's only used as
    // the DOM attribute payload so that already-seen items can be
    // recognised on subsequent scrapes.
    let _isNew = false;
    if (!item.hasAttribute('data-lhr-idx')) {
      item.setAttribute('data-lhr-idx', String(window.__lhrNextIdx++));
      _isNew = true;
    }

    // --- Author info ---
    let authorName = null;
    let authorHeadline = null;
    let authorProfileUrl = null;
    let timestamp = null;

    // Name and profile URL both come from the author anchor.  Reading them
    // from one element is what makes disagreement impossible: the control
    // menu's aria-label is deliberately NOT a name source, because nothing
    // ties it structurally to the anchor the URL comes from.
    const authorAnchor = findAuthorAnchor(item);
    if (authorAnchor) {
      authorProfileUrl = authorAnchor.href.split('?')[0] || null;

      // All three remaining fields are read from ONE field sequence taken off
      // that same anchor.  The previous read took the 3rd <p> for the headline
      // and the last time-like <p> for the timestamp, which returned nothing at
      // all for an anchor rendering its fields as <span> runs — the whole legacy
      // dialect, issue #898 — and the positional rule does not survive being
      // widened to <span>, because the accessible shapes render many more of
      // them.  Reading FIELDS rather than tags is what makes this dialect-
      // agnostic; what falsifies it is LinkedIn rendering a field outside the
      // anchor, and there the honest answer is null, which is what it returns.
      const fields = anchorFields(authorAnchor);

      const scored = slugName(authorAnchor, fields);
      authorName = scored !== null ? scored.name : anchorName(authorAnchor);

      // The fields the name came out of, so the headline can be excluded from
      // them by position rather than by testing its content against the name.
      const nameSpan = nameFieldSpan(scored, authorName, fields);

      // Timestamp: the LAST field opening with a relative-time token.
      for (let i = fields.length - 1; i >= 0; i--) {
        const timestampMatch = fields[i].match(FIELD_TIMESTAMP);
        if (timestampMatch) {
          timestamp = timestampMatch[1];
          break;
        }
      }

      // Headline: the FIRST field that is none of the fields the name was read
      // from, a relative time, or the actor header's own chrome.
      //
      // The name's fields are dropped by INDEX, using the span the read above
      // already knows, rather than by testing each field's content against the
      // name.  A content test cannot tell the name's own field from a headline
      // that merely contains the name, so it discarded both; the origin is not
      // ambiguous that way.  It covers both of #860's families for the same
      // reason — a split name spans indices 0..1, a contaminated single field
      // spans just 0 — without needing to know which family this anchor is in.
      //
      // Every field opening with a relative time is skipped, not merely the one
      // the timestamp was taken from: this rule chooses by EXCLUSION and has no
      // positive test of its own, so any token the classifiers fail to
      // recognise is emitted to the user AS the headline.  That is why they
      // carry the same vocabulary as this repository's other three extractors
      // rather than a private subset of it, and why \`HEADER_CHROME\` exists at
      // all — before it, "• Following" in a company actor header WAS the
      // headline this loop reported.
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (i >= nameSpan.from && i < nameSpan.to) continue;
        if (FIELD_TIMESTAMP.test(field)) continue;
        if (DEGREE_ONLY.test(field)) continue;
        if (HEADER_CHROME.test(field)) continue;
        authorHeadline = field;
        break;
      }
    }

    // --- Post text ---
    // The feed DOM uses data-testid="expandable-text-box" for post body
    // text.  The optional "… more" button is a child of the text box and
    // must be stripped before reading textContent.
    let text = null;
    const textBox = item.querySelector('[data-testid="expandable-text-box"]');
    if (textBox) {
      const clone = textBox.cloneNode(true);
      const moreBtn = clone.querySelector('[data-testid="expandable-text-button"]');
      if (moreBtn) moreBtn.remove();
      text = (clone.textContent || '').trim() || null;
    }

    // --- Media type ---
    let mediaType = null;
    if (item.querySelector('video')) {
      mediaType = 'video';
    } else if (item.querySelector('img[src*="media.licdn.com"]')) {
      const imgs = item.querySelectorAll('img[src*="media.licdn.com"]');
      for (const img of imgs) {
        if (img.offsetHeight > 100) { mediaType = 'image'; break; }
      }
    }

    // --- Engagement counts ---
    const itemText = item.textContent || '';

    function parseCount(pattern) {
      const m = itemText.match(pattern);
      if (!m) return 0;
      const raw = m[1].replace(/,/g, '');
      const num = parseInt(raw, 10);
      return isNaN(num) ? 0 : num;
    }

    const reactionCount = parseCount(/(\\d[\\d,]*)\\s+reactions?/i);
    const commentCount = parseCount(/(\\d[\\d,]*)\\s+comments?/i);
    const shareCount = parseCount(/(\\d[\\d,]*)\\s+reposts?/i);

    posts.push({
      _isNew: _isNew,
      url: null,
      authorName: authorName,
      authorHeadline: authorHeadline,
      authorProfileUrl: authorProfileUrl,
      text: text,
      mediaType: mediaType,
      reactionCount: reactionCount,
      commentCount: commentCount,
      shareCount: shareCount,
      timestamp: timestamp,
    });
  }

  return posts;
})()`;

/**
 * Legacy scraping script using structural heuristics to find the feed
 * container.  Used by search-posts which navigates to search result
 * pages where `data-testid="mainFeed"` is not present.
 *
 * @internal Exported for reuse by search-posts.
 */
export { SCRAPE_FEED_POSTS_SCRIPT as SCRAPE_FEED_SCRIPT };

// ---------------------------------------------------------------------------
// URL capture via three-dot menu → "Copy link to post"
// ---------------------------------------------------------------------------

/** CSS selector for feed post menu buttons. */
const FEED_MENU_BUTTON_SELECTOR =
  '[data-testid="mainFeed"] div[role="listitem"] button[aria-label^="Open control menu for post"]';

/**
 * Capture the post URL for a single feed item by opening its three-dot
 * menu and clicking "Copy link to post".
 *
 * Requires the clipboard interceptor to be installed beforehand via
 * {@link installClipboardInterceptor}.
 *
 * @returns The post URL (query params stripped) or `null` if capture failed.
 */
async function capturePostUrl(
  client: CDPClient,
  postIndex: number,
  mouse?: HumanizedMouse | null,
): Promise<string | null> {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await maybeHesitate(); // Probabilistic pause before menu interaction

    // Reset clipboard capture
    await client.evaluate(`window.__capturedClipboard = null;`);

    // Scroll the menu button into view (humanized when mouse available)
    await humanizedScrollToByIndex(client, FEED_MENU_BUTTON_SELECTOR, postIndex, mouse);

    // Click the menu button
    const clicked = await client.evaluate<boolean>(`(() => {
      const btns = document.querySelectorAll(
        ${JSON.stringify(FEED_MENU_BUTTON_SELECTOR)}
      );
      const btn = btns[${postIndex}];
      if (!btn) return false;
      btn.click();
      return true;
    })()`);

    if (!clicked) return null; // No menu button — structural, retrying won't help

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
    const postUrl =
      await client.evaluate<string | null>(`window.__capturedClipboard`);

    if (postUrl) {
      // Strip query parameters
      return postUrl.split("?")[0] ?? postUrl;
    }

    // Dismiss any open menu before retrying
    await client.evaluate(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    })()`);

    // Escalating retry delays: longer waits on later attempts
    const retryDelays = [
      { mean: 700, stdDev: 200 },
      { mean: 1_200, stdDev: 400 },
      { mean: 2_500, stdDev: 800 },
    ] as const;
    const rd = retryDelays[attempt] ?? retryDelays[2];
    await gaussianDelay(rd.mean, rd.stdDev, rd.mean * 0.5, rd.mean * 1.5);

    // 50% chance of a small "confusion" scroll to reset visual state
    if (Math.random() < 0.5) {
      const scrollDist = Math.round(gaussianBetween(75, 15, 50, 100));
      const dir = Math.random() < 0.5 ? -1 : 1;
      await humanizedScrollY(client, scrollDist * dir, 300, 400, mouse);
      await gaussianDelay(300, 100, 150, 500);
    }
  }

  return null;
}

/**
 * Install a clipboard interceptor that captures `navigator.clipboard.writeText`
 * calls into `window.__capturedClipboard`.  Required because Electron's
 * clipboard API is broken (readText returns `{}`).
 */
async function installClipboardInterceptor(client: CDPClient): Promise<void> {
  await client.evaluate(
    `navigator.clipboard.writeText = function(text) {
      window.__capturedClipboard = text;
      return Promise.resolve();
    };`,
  );
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract hashtags from post text.
 */
export function extractHashtags(text: string | null): string[] {
  if (!text) return [];
  const matches = text.match(/#[\w\u00C0-\u024F]+/g);
  return matches ? [...new Set(matches.map((t) => t.slice(1)))] : [];
}

/**
 * Parse a relative timestamp string (e.g. "52m", "16h", "2d", "1w", "1mo") or
 * an ISO date into epoch milliseconds.  Returns null for unrecognised formats.
 *
 * The `mo` (month) unit is approximated as 30 days — LinkedIn emits `Nmo`
 * for posts ~30-330 days old (per `getPost`'s post-detail body extraction);
 * without it, the `Nmo` regex match in `get-post.ts` would still produce
 * `null` here, silently dropping `publishedAt` for older posts.  The 30-day
 * approximation is consistent with LinkedIn's own UX (which also rounds).
 */
export function parseTimestamp(raw: string | null): number | null {
  if (!raw) return null;

  // ISO datetime
  const asDate = Date.parse(raw);
  if (!isNaN(asDate)) return asDate;

  // Relative time: Ns, Nm, Nh, Nd, Nw, Nmo (mo = ~30 days), Ny / Nyr (~365
  // days).  The alternation tries the longer units first so `1mo` matches `mo`
  // (not `m` with a leftover `o`) and `1yr` matches `yr` (not `y` with a
  // leftover `r`) — the same reason the feed extractor's own `FIELD_TIMESTAMP`
  // orders its branches that way.  The year units are accepted here because
  // that extractor can now EMIT them: a token it classifies as a timestamp and
  // this parser drops would silently reset `publishedAt` to null for older
  // reshared posts, which is the failure `mo` was added to fix.
  const match = raw.match(/^(\d+)(mo|yr|y|[smhdw])$/);
  if (!match) return null;

  const value = parseInt(match[1] ?? "0", 10);
  const unit = match[2] ?? "";
  const now = Date.now();

  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    mo: 2_592_000_000,
    y: 31_536_000_000,
    yr: 31_536_000_000,
  };

  return now - value * (multipliers[unit] ?? 0);
}

/**
 * Build a LinkedIn post URL from an activity URN.
 */
/** @internal Exported for reuse by search-posts. */
export function buildPostUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

/**
 * Convert raw DOM-scraped posts into normalised FeedPost entries.
 */
/** @internal Exported for reuse by search-posts. */
export function mapRawPosts(raw: RawDomPost[]): FeedPost[] {
  return raw.map((r) => ({
    url: r.url ?? null,
    authorName: r.authorName,
    authorHeadline: r.authorHeadline,
    authorProfileUrl: r.authorProfileUrl,
    authorPublicId: null,
    text: r.text,
    mediaType: r.mediaType,
    reactionCount: r.reactionCount,
    commentCount: r.commentCount,
    shareCount: r.shareCount,
    timestamp: parseTimestamp(r.timestamp),
    hashtags: extractHashtags(r.text),
  }));
}

// ---------------------------------------------------------------------------
// Scroll helper
// ---------------------------------------------------------------------------

/** @internal Exported for reuse by other operations. */
export const delay = utilsDelay;

/**
 * Scroll the feed down by a randomised viewport-like distance.
 *
 * The distance varies between 600–1000 px per scroll to avoid the
 * detection signal of a perfectly uniform scroll cadence.
 *
 * When a {@link HumanizedMouse} is provided, scrolling uses incremental
 * mouse-wheel strokes (150 px / 25 ms) that mimic a physical scroll
 * wheel.  Falls back to a single CDP `mouseWheel` event otherwise.
 *
 * @internal Exported for reuse by search-posts.
 */
export async function scrollFeed(
  client: CDPClient,
  mouse?: HumanizedMouse | null,
): Promise<void> {
  const distance = Math.round(gaussianBetween(800, 100, 600, 1_000));
  const x = Math.round(gaussianBetween(350, 100, 150, 550));
  const y = Math.round(gaussianBetween(400, 80, 250, 550));
  await humanizedScrollY(client, distance, x, y, mouse);
}

// ---------------------------------------------------------------------------
// Wait for feed to load
// ---------------------------------------------------------------------------

/** @internal Exported for reuse by search-posts. */
export async function waitForFeedLoad(
  client: CDPClient,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate<boolean>(`(() => {
      const feed = document.querySelector('[data-testid="mainFeed"]');
      if (!feed) return false;
      const items = feed.querySelectorAll('div[role="listitem"]');
      // Ready when at least one listitem has a post menu button
      for (const item of items) {
        if (item.querySelector('button[aria-label^="Open control menu for post"]')) {
          return true;
        }
      }
      return false;
    })()`);
    if (ready) return;
    await delay(500);
  }
  throw new Error(
    "Timed out waiting for feed posts to appear in the DOM",
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the LinkedIn home feed and return structured post data.
 *
 * Navigates to the feed page and extracts posts from the rendered DOM.
 * Supports cursor-based pagination: the first call returns the first page;
 * pass the returned `nextCursor` in subsequent calls to retrieve additional
 * pages via scroll + re-scrape.
 *
 * @param input - Pagination parameters and CDP connection options.
 * @returns Feed posts with a cursor for the next page.
 */
export async function getFeed(
  input: GetFeedInput,
): Promise<GetFeedOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const count = input.count ?? 10;
  const cursor = input.cursor ?? null;

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
    const mouse = input.mouse ?? null;

    // Navigate away if already on the feed page to force a fresh load
    await navigateAwayIf(client, "/feed");
    await client.navigate("https://www.linkedin.com/feed/");

    // Wait for the initial feed content to render
    await waitForFeedLoad(client);

    // Collect posts — scroll to load more if needed.
    //
    // LinkedIn's main feed virtualises off-screen posts out of the DOM,
    // so each point-in-time scrape only sees ~8-13 items.  To accumulate
    // beyond that cap we tag discovered listitems with `data-lhr-idx`
    // and interleave URL extraction with scrolling so that each post's
    // URL is captured while the element is still visible.
    //
    // The target is counted in URL-bearing posts only (`seenUrls.size`).
    // Posts whose URL extraction failed are still accumulated for
    // completeness but don't count toward the target — otherwise a run
    // of transient failures could make the loop exit with a window of
    // null-URL posts and no usable cursor.
    //
    // We need `count` posts plus one extra so the hasMore check has a
    // post beyond the result window.  Cursor calls use `count * 2 + 1`:
    // up to `count` posts may be consumed locating the cursor, then
    // `count` more for the next page, plus one for hasMore.
    const maxScrollAttempts = 10;
    const allPosts: RawDomPost[] = [];
    const seenUrls = new Set<string>();
    const accumulationTarget = cursor ? count * 2 + 1 : count + 1;
    let previousUrlCount = 0;

    type TaggedPost = RawDomPost & { _isNew: boolean };

    // If resuming with a cursor, we need to scroll past already-seen posts
    const cursorUrl = cursor;

    // Install the clipboard interceptor before the scroll loop so that
    // URL extraction can happen inside each iteration.
    await installClipboardInterceptor(client);

    for (let scroll = 0; scroll <= maxScrollAttempts; scroll++) {
      const countBefore = allPosts.length;

      // Scrape visible posts — the script tags each listitem with a
      // discovery index and reports which items are newly discovered.
      const scraped = await client.evaluate<TaggedPost[]>(SCRAPE_FEED_POSTS_SCRIPT);
      const batch = scraped ?? [];

      // Extract URLs for newly discovered posts while they are visible.
      // `domIdx` is the position within the current batch which matches
      // the DOM order of visible menu buttons.
      //
      // To avoid extracting URLs for far more posts than needed (each
      // extraction opens the three-dot menu — ~1-2 s per post), we stop
      // once we have enough URL-bearing posts.
      let extractedInBatch = 0;
      for (let domIdx = 0; domIdx < batch.length; domIdx++) {
        const post = batch[domIdx];
        if (!post?._isNew) continue;

        // Stop extracting once we have enough URL-bearing posts
        if (seenUrls.size >= accumulationTarget) break;

        if (extractedInBatch > 0) await gaussianDelay(550, 125, 300, 800);
        await maybeBreak();

        const url = await retryInteraction(
          () => capturePostUrl(client, domIdx, mouse),
        );
        if (url) {
          post.url = url;
        }
        extractedInBatch++;

        // Accumulate the post (dedup by URL when available)
        if (post.url) {
          if (!seenUrls.has(post.url)) {
            seenUrls.add(post.url);
            allPosts.push(post);
          }
        } else {
          // URL extraction failed — include for completeness but don't
          // count toward accumulationTarget (see comment above).
          allPosts.push(post);
        }
      }

      // Enough URL-bearing posts accumulated?
      if (seenUrls.size >= accumulationTarget) break;

      // No new URL-bearing posts after scroll — stop
      if (seenUrls.size === previousUrlCount && scroll > 0) break;

      const newPostCount = allPosts.length - countBefore;
      previousUrlCount = seenUrls.size;

      // Scroll to load more
      if (scroll < maxScrollAttempts) {
        await scrollFeed(client, mouse);

        // Progressive session fatigue: delays increase with each scroll
        const fatigueMultiplier = 1 + scroll * 0.1;
        // Scale delay by newly visible content volume
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

    // Slice the result window
    let startIdx = 0;
    if (cursorUrl) {
      const cursorIdx = allPosts.findIndex((p) => p.url === cursorUrl);
      if (cursorIdx >= 0) {
        startIdx = cursorIdx + 1;
      }
    }

    const window = allPosts.slice(startIdx, startIdx + count);
    const posts = mapRawPosts(window);

    // Determine next cursor — scan backwards for the nearest post with a
    // non-null URL so that a single failed URL extraction doesn't block
    // pagination when more posts are available.
    const hasMore = startIdx + count < allPosts.length;
    let nextCursor: string | null = null;
    if (hasMore) {
      for (let i = window.length - 1; i >= 0; i--) {
        const postUrl = window[i]?.url;
        if (postUrl) {
          nextCursor = postUrl;
          break;
        }
      }
    }

    await gaussianDelay(800, 300, 300, 1_800); // Post-action dwell
    return { posts, nextCursor };
  } finally {
    client.disconnect();
  }
}
