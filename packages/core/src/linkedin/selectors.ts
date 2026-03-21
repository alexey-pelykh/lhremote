// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Centralized CSS selector registry for LinkedIn DOM elements.
 *
 * Each selector targets a specific UI element needed for content
 * interaction (feed reading, commenting, reacting).  When LinkedIn
 * changes their DOM structure, integration tests identify broken
 * selectors by name.
 */

// ── Feed post containers ──────────────────────────────────────────

/** Individual feed post wrapper. */
export const FEED_POST_CONTAINER = "div.feed-shared-update-v2";

/** Text content within a feed post. */
export const POST_TEXT_CONTENT = ".feed-shared-update-v2__description";

// ── Author info ───────────────────────────────────────────────────

/** Post author's display name. */
export const POST_AUTHOR_NAME = ".update-components-actor__title";

/** Post author's headline / description line. */
export const POST_AUTHOR_INFO = ".update-components-actor__description";

// ── Comment input fields ──────────────────────────────────────────

/** Rich-text editor for writing comments (Quill-based). */
export const COMMENT_INPUT = ".comments-comment-texteditor .ql-editor";

// ── Reaction buttons ──────────────────────────────────────────────

/** Main reaction trigger button (Like / React). */
export const REACTION_TRIGGER = "button.react-button__trigger";

/** Reactions popup menu container (appears on hover). */
export const REACTIONS_MENU = ".reactions-menu";

/** Like reaction button inside the reactions menu. */
export const REACTION_LIKE = '.reactions-menu button[aria-label="React Like"]';

/** Celebrate reaction button inside the reactions menu. */
export const REACTION_CELEBRATE = '.reactions-menu button[aria-label="React Celebrate"]';

/** Support reaction button inside the reactions menu. */
export const REACTION_SUPPORT = '.reactions-menu button[aria-label="React Support"]';

/** Love reaction button inside the reactions menu. */
export const REACTION_LOVE = '.reactions-menu button[aria-label="React Love"]';

/** Insightful reaction button inside the reactions menu. */
export const REACTION_INSIGHTFUL = '.reactions-menu button[aria-label="React Insightful"]';

/** Funny reaction button inside the reactions menu. */
export const REACTION_FUNNY = '.reactions-menu button[aria-label="React Funny"]';

// ── Send / submit buttons ─────────────────────────────────────────

/** Submit button for the comment form. */
export const COMMENT_SUBMIT_BUTTON = 'button[class*="comments-comment-box__submit-button"]';

// ── Scroll containers ─────────────────────────────────────────────

/** Main scrollable feed container. */
export const SCROLL_CONTAINER = ".scaffold-finite-scroll";

// ── Pagination triggers ───────────────────────────────────────────

/** "Show more" / load-more button for feed pagination. */
export const PAGINATION_TRIGGER = ".scaffold-finite-scroll__load-button";

/**
 * Aggregated registry of all selectors, keyed by name.
 *
 * Useful for iterating over all selectors in tests or for
 * dynamic lookup by name at runtime.
 */
export const SELECTORS = {
  FEED_POST_CONTAINER,
  POST_TEXT_CONTENT,
  POST_AUTHOR_NAME,
  POST_AUTHOR_INFO,
  COMMENT_INPUT,
  REACTION_TRIGGER,
  REACTIONS_MENU,
  REACTION_LIKE,
  REACTION_CELEBRATE,
  REACTION_SUPPORT,
  REACTION_LOVE,
  REACTION_INSIGHTFUL,
  REACTION_FUNNY,
  COMMENT_SUBMIT_BUTTON,
  SCROLL_CONTAINER,
  PAGINATION_TRIGGER,
} as const;

/** Union of all selector names in the registry. */
export type SelectorName = keyof typeof SELECTORS;
