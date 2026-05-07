// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Centralized CSS selector registry for LinkedIn DOM elements.
 *
 * Each selector targets a specific UI element needed for content
 * interaction (feed reading, commenting, reacting).  When LinkedIn
 * changes their DOM structure, integration tests identify broken
 * selectors by name.
 *
 * **Note:** LinkedIn currently serves two different frontend stacks:
 *
 * - **Feed page** (`/feed/`): CSS modules with hashed class names,
 *   ProseMirror/TipTap editor, modern aria-label patterns.
 * - **Post page** (`/posts/...`, `/feed/update/...`): Legacy Ember.js
 *   with BEM class names (`artdeco-button`, `react-button__trigger`),
 *   Quill editor (`.ql-editor`), different aria-label wording.
 *
 * All selectors use CSS selector lists (comma-separated) to match
 * both variants where they differ.
 */

// ── Feed post containers ──────────────────────────────────────────

/** Individual feed post wrapper (listitem inside the main feed). */
export const FEED_POST_CONTAINER = '[data-testid="mainFeed"] [role="listitem"]';

// ── Comment input fields ──────────────────────────────────────────

/**
 * Rich-text editor for writing comments.
 *
 * - Feed page: ProseMirror/TipTap `div[role="textbox"]` with
 *   `aria-label="Text editor for creating comment"`.
 * - Post page: Quill editor with `role="textbox"` and
 *   `aria-label="Text editor for creating content"`.
 *
 * Both variants share `role="textbox"` and the `aria-label` prefix
 * "Text editor for creating", so a single selector covers both.
 */
export const COMMENT_INPUT =
  '[role="textbox"][aria-label^="Text editor for creating"]';

// ── Reaction buttons ──────────────────────────────────────────────

/**
 * Main reaction trigger button (Like / React).
 *
 * - Feed page: `aria-label` starts with "Reaction button state:".
 * - Post page: `button.react-button__trigger` (BEM class, various
 *   aria-labels like "Unreact Like", "React Like to X's comment").
 */
export const REACTION_TRIGGER =
  'button[aria-label^="Reaction button state"], button.react-button__trigger';

/**
 * Like reaction button (appears after hovering {@link REACTION_TRIGGER}).
 *
 * The reactions popup has no container element on the feed page —
 * individual buttons appear directly in the DOM after a ~3 s
 * CDP-level hover.  On the post page, the popup uses the legacy
 * `.reactions-menu` container.
 *
 * - Feed page: `button[aria-label="Like"]`
 * - Post page: `button[aria-label="React Like"]`
 *   (inside `.reactions-menu`)
 */
export const REACTION_LIKE =
  'button[aria-label="Like"], button[aria-label="React Like"]';

/** Celebrate reaction button (appears after hovering trigger). */
export const REACTION_CELEBRATE =
  'button[aria-label="Celebrate"], button[aria-label="React Celebrate"]';

/** Support reaction button (appears after hovering trigger). */
export const REACTION_SUPPORT =
  'button[aria-label="Support"], button[aria-label="React Support"]';

/** Love reaction button (appears after hovering trigger). */
export const REACTION_LOVE =
  'button[aria-label="Love"], button[aria-label="React Love"]';

/** Insightful reaction button (appears after hovering trigger). */
export const REACTION_INSIGHTFUL =
  'button[aria-label="Insightful"], button[aria-label="React Insightful"]';

/** Funny reaction button (appears after hovering trigger). */
export const REACTION_FUNNY =
  'button[aria-label="Funny"], button[aria-label="React Funny"]';

// ── Comment reply ────────────────────────────────────────────────

/**
 * Reply button inside a comment `article`.
 *
 * Each comment on the post detail page has a Reply button whose
 * `aria-label` follows the pattern "Reply to {name}'s comment".
 * The button uses the BEM class
 * `comments-comment-social-bar__reply-action-button--cr`.
 */
export const COMMENT_REPLY_BUTTON = 'button[aria-label^="Reply to "]';

/**
 * State-bearing reaction button inside a comment `article`.
 *
 * Each comment has a direct Like-toggle button whose `aria-label`
 * encodes both the action and the current state:
 *
 * - Not reacted:  `"React Like to {name}'s comment"`
 * - Reacted:      `"Unreact Like"` / `"Unreact Like to {name}'s comment"`
 *                 (and `"Unreact Celebrate"`, `"Unreact Support"`, etc.,
 *                 when the user reacted with a non-Like reaction via the
 *                 popup).
 *
 * Reading this button's `aria-label` is sufficient for state detection.
 * Clicking it directly applies/unreacts a Like — but to apply a NON-Like
 * reaction (Celebrate, Support, Love, Insightful, Funny), the
 * {@link COMMENT_REACTIONS_MENU} button must be used to open the popup.
 *
 * Compose with an article scope, e.g.
 * `article[data-id="${commentUrn}"] ${COMMENT_REACTION_TRIGGER}`.
 * Both branches are wrapped in `:is(...)` so the article scope applies
 * to BOTH branches.
 */
export const COMMENT_REACTION_TRIGGER =
  'button:is([aria-label^="React Like to "], [aria-label^="Unreact "])';

/**
 * Popup-opening button inside a comment `article`.
 *
 * Distinct from the state-bearing {@link COMMENT_REACTION_TRIGGER}.
 * Hovering this button expands the reactions popup with all 6
 * reaction buttons (Like / Celebrate / Support / Love / Insightful /
 * Funny), which then match the post-level {@link REACTION_LIKE},
 * {@link REACTION_CELEBRATE}, etc. selectors.
 *
 * Compose with an article scope, e.g.
 * `article[data-id="${commentUrn}"] ${COMMENT_REACTIONS_MENU}`.
 *
 * On the post itself, an `"Open reactions menu"`-labeled button also
 * exists alongside the post-level reaction trigger.  Always scope to
 * the comment article to avoid cross-scope matches.
 */
export const COMMENT_REACTIONS_MENU =
  'button[aria-label="Open reactions menu"]';

// ── React-stack post detail (LinkedIn 2026-05 SDUI rewrite) ──────

/**
 * Outer post-detail container on the React/SDUI post-detail page.
 *
 * **Stack note**: as of LinkedIn's React/SDUI post-detail rewrite (live by
 * 2026-05), the post body is wrapped by a div whose `componentkey` matches
 * `expanded{POSTID_HASH}FeedType_FEED_DETAIL`.  Two nested elements share
 * the same key.  This container's descendants are exactly the post body
 * (author avatar/name links, headline, post text, post-level reaction
 * trigger) — the comment list is a SIBLING, not a descendant, so this
 * scope cleanly excludes comment-author and comment-text content.
 *
 * **Why this selector**: the legacy `[data-testid="mainFeed"]` →
 * `div[role="listitem"]` cascade silently falls through to `<main>` after
 * the SDUI rewrite, causing the FIRST `a[href*="/in/"]` inside `<main>`
 * (which is the LinkedIn Premium upsell banner pointing at the current
 * user's profile) to be selected as the post author.  Scoping by this
 * componentkey prefix is the verified-stable mechanism for excluding
 * sidebar / chrome / comment-list anchors.
 *
 * See `research/linkedin/post-detail-body-dom-react-sdui-20260507.md` and
 * lhremote issue #800.
 */
export const POST_DETAIL_CONTAINER =
  '[componentkey^="expanded"][componentkey$="FeedType_FEED_DETAIL"]';

/**
 * Fallback scope: SDUI screen wrapper for the post-detail page.
 *
 * Used when {@link POST_DETAIL_CONTAINER} doesn't match (e.g., LinkedIn
 * renames the `expanded` prefix).  This selector targets the screen-level
 * SDUI marker which has been stable since the May 2026 rewrite — but it
 * INCLUDES the comment list as a descendant, so callers must additionally
 * exclude `[data-component-type="LazyColumn"]` and
 * `[componentkey^="replaceableComment_"]` when used as a post-author scope.
 */
export const POST_DETAIL_SDUI_SCREEN =
  '[data-sdui-screen="com.linkedin.sdui.flagshipnav.feed.UpdateDetail"]';

/**
 * Post body text leaf — primary selector.
 *
 * The post body text is rendered as a `<span>` with `data-testid="expandable-text-box"`
 * inside a `<p componentkey="feed-commentary_{UUID}">` wrapper.  This SPAN
 * is a leaf (no nested elements split the text), so its `textContent` is
 * the full post body verbatim.
 *
 * Absent on very short posts (below the truncation threshold — observed
 * at ~25 characters).  Use {@link POST_DETAIL_BODY_COMMENTARY_WRAPPER} as
 * the fallback when this selector returns null.
 */
export const POST_DETAIL_BODY_TEXT_LEAF =
  '[data-testid="expandable-text-box"]';

/**
 * Post body wrapper — fallback selector.
 *
 * The `<p>` element wrapping {@link POST_DETAIL_BODY_TEXT_LEAF}.  Used
 * when the leaf SPAN is absent (very short posts).  May contain
 * additional whitespace from the wrapper's own structure, but is
 * still scoped to the post body only.
 */
export const POST_DETAIL_BODY_COMMENTARY_WRAPPER =
  '[componentkey^="feed-commentary_"]';

/**
 * Post-level reactions menu opener (NEW marker post-2026-05 rewrite).
 *
 * Replaces the legacy `button[aria-label^="React Like to "]` direct-Like
 * trigger which is gone from the SDUI post-detail page (verified across
 * regular / share / ugcPost / self-authored URLs).  The new aria-label is
 * shared between post-level AND comment-level reaction openers; scope to
 * the post container (or to a specific comment article) to disambiguate.
 *
 * For wait-for-post-load.ts readiness, this is the post-level analog of
 * {@link COMMENT_REACTIONS_MENU} — they share the same selector but
 * different scopes.
 */
export const POST_REACTIONS_MENU =
  'button[aria-label="Open reactions menu"]';

/**
 * Selects ANY comment article on the post-detail page.
 *
 * **Stack note**: as of LinkedIn's React/SDUI post-detail rewrite (live by
 * 2026-05), comments are no longer `<article class="comments-comment-entity">`.
 * Each comment is a `<div componentkey="replaceableComment_<URN>">` rendered
 * inside a `<div data-component-type="LazyColumn" data-testid="...commentList...FeedType_FEED_DETAIL">`
 * container.  Three nested `<div>` elements share the same `componentkey`
 * value (outer wrapper, mid wrapper, inner content row); the selector
 * matches all three but `waitForElement` style usage is unaffected.
 *
 * Use with `waitForElement` to anchor on the comments section having
 * hydrated at least one comment.  Pair with {@link commentArticleSelectorByUrn}
 * to scope subsequent selectors to a specific comment.
 *
 * See `research/linkedin/post-detail-comment-dom-react-sdui-20260506.md` and
 * lhremote issue #776.
 */
export const COMMENT_ARTICLE_ANY = '[componentkey^="replaceableComment_"]';

/**
 * Build a selector that scopes to a specific comment article by URN.
 *
 * @param urn  Comment URN in the React-stack format
 *             (`urn:li:comment:(urn:li:activity:<postId>,<commentId>)`).
 *             Use {@link normalizeCommentUrnForReactStack} if you have the
 *             legacy format `urn:li:comment:(activity:N,M)`.
 *
 * Returns a selector that matches the three nested elements sharing the
 * same `componentkey`.  For scoped queries (e.g. finding a button inside
 * the comment) the scope works regardless of which level the descendant
 * lives at.
 */
export function commentArticleSelectorByUrn(urn: string): string {
  return `[componentkey="replaceableComment_${urn}"]`;
}

/**
 * Convert a legacy comment URN (`urn:li:comment:(activity:N,M)`) to the
 * React-stack format (`urn:li:comment:(urn:li:activity:N,M)`).
 *
 * The legacy format was emitted by `get-post` and consumed by
 * `comment-on-post` / `react-to-comment` against the Ember stack.  After
 * LinkedIn's SDUI rewrite, the inner `activity:` segment is fully URN-qualified
 * (`urn:li:activity:`).  The DOM only matches the new format, so client
 * input in either form is normalized here before DOM lookups.
 *
 * @returns the new-format URN if the input matches the legacy form;
 *          otherwise returns the input unchanged (idempotent for new format
 *          and inputs that don't match either pattern).
 */
export function normalizeCommentUrnForReactStack(urn: string): string {
  // Legacy:  urn:li:comment:(activity:N,M)
  // SDUI:    urn:li:comment:(urn:li:activity:N,M)
  const legacy = /^urn:li:comment:\((\w+):(\d+),(\d+)\)$/.exec(urn);
  if (legacy) {
    const type = legacy[1];
    const postId = legacy[2];
    const commentId = legacy[3];
    return `urn:li:comment:(urn:li:${type}:${postId},${commentId})`;
  }
  return urn;
}

/**
 * Convert a React-stack comment URN (`urn:li:comment:(urn:li:activity:N,M)`)
 * back to the legacy format (`urn:li:comment:(activity:N,M)`).
 *
 * Inverse of {@link normalizeCommentUrnForReactStack}.  Used by `get-post` to
 * preserve API output stability — `get-post`'s `commentUrn` field has emitted
 * the legacy shape since the operation existed; the SDUI rewrite would
 * silently change the format if URNs were extracted directly from
 * `componentkey` without renormalization.  Callers that downstream pass the
 * URN to `comment-on-post` or `react-to-comment` are unaffected because
 * those skills accept both forms (and re-normalize to SDUI for DOM lookups).
 *
 * @returns the legacy-format URN if the input matches the React-stack form;
 *          otherwise returns the input unchanged (idempotent for legacy form
 *          and inputs that don't match either pattern).
 */
export function denormalizeCommentUrnToLegacy(urn: string): string {
  // SDUI:    urn:li:comment:(urn:li:activity:N,M)
  // Legacy:  urn:li:comment:(activity:N,M)
  const sdui = /^urn:li:comment:\(urn:li:(\w+):(\d+),(\d+)\)$/.exec(urn);
  if (sdui) {
    const type = sdui[1];
    const postId = sdui[2];
    const commentId = sdui[3];
    return `urn:li:comment:(${type}:${postId},${commentId})`;
  }
  return urn;
}

// ── Mention autocomplete ─────────────────────────────────────────

/**
 * Mention typeahead popup (appears after typing `@` in the comment editor).
 *
 * LinkedIn's Quill editor triggers a typeahead dropdown whose listbox
 * is rendered inside a `.editor-typeahead-fetch` wrapper.  The listbox
 * itself uses `role="listbox"` with class `basic-typeahead__triggered-content`.
 */
export const MENTION_TYPEAHEAD =
  '.editor-typeahead-fetch .basic-typeahead__triggered-content[role="listbox"]';

/**
 * Individual mention option inside the typeahead popup.
 *
 * Each option has `role="option"` and toggles `aria-selected` on
 * keyboard navigation (ArrowDown / ArrowUp).
 */
export const MENTION_OPTION =
  '.basic-typeahead__selectable.editor-typeahead__typeahead-item[role="option"]';

// ── Send / submit buttons ─────────────────────────────────────────

/**
 * Submit button for the comment form.
 *
 * - Feed page: `button[type="submit"]` (starts disabled, enabled
 *   after typing).
 * - Post page: BEM class `comments-comment-box__submit-button`.
 */
export const COMMENT_SUBMIT_BUTTON =
  'button[type="submit"], button[class*="comments-comment-box__submit-button"]';

/**
 * Aggregated registry of all selectors, keyed by name.
 *
 * Useful for iterating over all selectors in tests or for
 * dynamic lookup by name at runtime.
 */
export const SELECTORS = {
  FEED_POST_CONTAINER,
  COMMENT_INPUT,
  COMMENT_REPLY_BUTTON,
  COMMENT_REACTION_TRIGGER,
  COMMENT_REACTIONS_MENU,
  MENTION_TYPEAHEAD,
  MENTION_OPTION,
  REACTION_TRIGGER,
  REACTION_LIKE,
  REACTION_CELEBRATE,
  REACTION_SUPPORT,
  REACTION_LOVE,
  REACTION_INSIGHTFUL,
  REACTION_FUNNY,
  COMMENT_SUBMIT_BUTTON,
} as const;

/** Union of all selector names in the registry. */
export type SelectorName = keyof typeof SELECTORS;
