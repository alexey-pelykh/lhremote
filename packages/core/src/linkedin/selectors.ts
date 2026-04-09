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
