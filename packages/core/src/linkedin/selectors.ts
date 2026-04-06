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
 * **Note:** LinkedIn migrated to CSS modules with hashed class names
 * in early 2026.  All selectors now use stable attributes
 * (`aria-label`, `role`, `data-testid`) instead of class names.
 */

// ── Feed post containers ──────────────────────────────────────────

/** Individual feed post wrapper (listitem inside the main feed). */
export const FEED_POST_CONTAINER = '[data-testid="mainFeed"] [role="listitem"]';

// ── Comment input fields ──────────────────────────────────────────

/** Rich-text editor for writing comments (ProseMirror / TipTap). */
export const COMMENT_INPUT =
  'div[role="textbox"][aria-label="Text editor for creating comment"]';

// ── Reaction buttons ──────────────────────────────────────────────

/**
 * Main reaction trigger button (Like / React).
 *
 * The `aria-label` starts with "Reaction button state:" followed by
 * the current state, e.g. "no reaction" or "Like".
 */
export const REACTION_TRIGGER =
  'button[aria-label^="Reaction button state"]';

/**
 * Like reaction button (appears after hovering {@link REACTION_TRIGGER}).
 *
 * The reactions popup has no container element — individual buttons
 * appear directly in the DOM after a ~3 s CDP-level hover on the
 * trigger.  Synthetic JS `mouseenter`/`mouseover` events do **not**
 * trigger the popup; use `Input.dispatchMouseEvent` instead.
 */
export const REACTION_LIKE = 'button[aria-label="Like"]';

/** Celebrate reaction button (appears after hovering trigger). */
export const REACTION_CELEBRATE = 'button[aria-label="Celebrate"]';

/** Support reaction button (appears after hovering trigger). */
export const REACTION_SUPPORT = 'button[aria-label="Support"]';

/** Love reaction button (appears after hovering trigger). */
export const REACTION_LOVE = 'button[aria-label="Love"]';

/** Insightful reaction button (appears after hovering trigger). */
export const REACTION_INSIGHTFUL = 'button[aria-label="Insightful"]';

/** Funny reaction button (appears after hovering trigger). */
export const REACTION_FUNNY = 'button[aria-label="Funny"]';

// ── Send / submit buttons ─────────────────────────────────────────

/**
 * Submit button for the comment form.
 *
 * LinkedIn renders at most one comment form at a time, so the broad
 * `button[type="submit"]` selector is safe in practice.  The button
 * starts `disabled` and becomes enabled after typing into the editor.
 */
export const COMMENT_SUBMIT_BUTTON = 'button[type="submit"]';

/**
 * Aggregated registry of all selectors, keyed by name.
 *
 * Useful for iterating over all selectors in tests or for
 * dynamic lookup by name at runtime.
 */
export const SELECTORS = {
  FEED_POST_CONTAINER,
  COMMENT_INPUT,
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
