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
 * - **Author name**: visible text of that author anchor — the same element
 *   the profile URL is read from, so the two cannot describe two people.
 *   Read from inside the anchor's `aria-hidden="true"` wrapper when it has
 *   one, so the screen-reader-only copy of the name beside it is not mistaken
 *   for the rendered one.
 * - **Author profile URL**: `href` of that same author anchor.
 * - **Author headline**: 3rd `<p>` in the author anchor.
 * - **Timestamp**: last `<p>` matching `\d+[smhdw]` in that anchor.
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

  // A relative-time token — "18h", "3d", "45m" — followed by the separator
  // LinkedIn renders after it, or by the end of the run.  Same token vocabulary
  // the timestamp read below uses; this form is unanchored because it is tested
  // against an anchor's whole concatenated text rather than one trimmed <p>.
  const RELATIVE_TIME_IN_TEXT = /\\d+[smhdw](?:\\s|[\\u2022\\u00B7]|$)/;

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
  // initials.  They are NOT joined — that swallows the neighbouring fields into
  // the name.  The name is the one rendered as a run, the same <p>/<span> shape
  // every other read here keys on, where a badge or a set of initials is bare
  // text in its wrapper.  Outermost wrappers only, so a nested one is not
  // considered twice, and decoration-only wrappers are dropped so a separator
  // bullet can never become the name.
  function visibleRoot(a) {
    const parts = [];
    for (const node of Array.from(a.querySelectorAll('[aria-hidden="true"]'))) {
      const txt = (node.textContent || '').trim();
      if (!txt || !NAME_LIKE.test(txt)) continue;
      if (parts.some(function (p) { return p.contains(node); })) continue;
      parts.push(node);
    }
    return parts.find(hasNameRun) || parts[0] || a;
  }

  // The name runs an element renders: <p> in the SDUI shape, <span> in the
  // legacy one.  Asking only WHETHER a run exists — never which tag carries it
  // — is what keeps every read below dialect-agnostic.  One selector list, not
  // two queries concatenated: the callers below take the FIRST run, and two
  // queries would order every <p> ahead of every <span> rather than in document
  // order, so a headline could outrank a name an anchor renders before it.
  function nameRuns(root) {
    return Array.from(root.querySelectorAll('p, span'));
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
      authorName = anchorName(authorAnchor);

      // Headline + timestamp come from that same anchor: it carries the
      // <p> run [name, connection degree, headline, timestamp].
      const pEls = Array.from(authorAnchor.querySelectorAll('p'));

      // Timestamp: last <p> containing a relative-time token (e.g. "18h •")
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
      // Company posts may have only 2 <p> elements (name + timestamp),
      // in which case authorHeadline stays null.
      if (pEls.length >= 3) {
        authorHeadline = (pEls[2].textContent || '').trim() || null;
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

  // Relative time: Ns, Nm, Nh, Nd, Nw, Nmo (mo = ~30 days).  The alternation
  // tries `mo` before `[smhdw]` so `1mo` matches `mo` (longer alternative),
  // not `m` followed by leftover `o`.
  const match = raw.match(/^(\d+)(mo|[smhdw])$/);
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
