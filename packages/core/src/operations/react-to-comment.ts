// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import {
  click,
  humanizedClick,
  humanizedScrollTo,
  retryInteraction,
  waitForDOMStable,
  waitForElement,
} from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import {
  commentArticleSelectorByUrn,
  COMMENT_ARTICLE_ANY,
  COMMENT_REACTIONS_MENU,
  normalizeCommentUrnForReactStack,
} from "../linkedin/selectors.js";
import { gaussianDelay } from "../utils/delay.js";
import { navigateAwayIf } from "./navigate-away.js";
import { REACTION_TYPES, type ReactionType } from "./react-to-post.js";
import type { ConnectionOptions } from "./types.js";

/** Pattern matching supported LinkedIn post URL formats. */
const LINKEDIN_POST_URL_RE =
  /linkedin\.com\/(?:feed\/update\/urn:li:\w+:\d+|posts\/[^/]+)/;

/**
 * Pattern matching a LinkedIn comment URN.
 *
 * Accepts BOTH formats:
 * - Legacy Ember stack: `urn:li:comment:(activity:123,456)`
 * - React/SDUI stack:   `urn:li:comment:(urn:li:activity:123,456)`
 *
 * Code paths normalize to the React-stack form via
 * `normalizeCommentUrnForReactStack` before DOM lookups.  See
 * `research/linkedin/post-detail-comment-dom-react-sdui-20260506.md`.
 */
const COMMENT_URN_RE = /^urn:li:comment:\((?:urn:li:)?\w+:\d+,\d+\)$/;

/**
 * JavaScript source that finds and clicks the "Load more comments" button
 * OR the "Show / See / Load / View previous replies" expander on nested
 * threads (replies to a comment).  Returns `true` if a button was clicked,
 * `false` otherwise.
 *
 * Reply commentUrns require expanding the parent comment's reply thread
 * before they appear in the DOM.  LinkedIn uses several verb variants
 * across locales and A/B tests: "Show previous replies", "See previous
 * replies", "Load previous replies", "View N replies", "X more replies".
 * Substring matches on `previous replies`, `more replies`, and the
 * top-level `more comments` cover all observed forms.
 */
const CLICK_LOAD_MORE_COMMENTS_SCRIPT = `(() => {
  const loadMoreSubstrings = [
    'load more comments',
    'show more comments',
    'view more comments',
    'see more comments',
    'previous replies',  // matches Show/See/Load/View "previous replies"
    'more replies',      // matches "View N more replies", "X more replies"
    'view replies',      // matches "View N replies"
    'show replies',
  ];
  const candidates = [
    ...document.querySelectorAll('button'),
    ...document.querySelectorAll('span[role="button"]'),
  ];
  for (const el of candidates) {
    const txt = (el.textContent || '').trim().toLowerCase();
    if (loadMoreSubstrings.some(t => txt.includes(t))) {
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    }
  }
  return false;
})()`;

/**
 * Maximum number of "Load more comments" clicks before giving up on
 * finding a specific comment URN.  Each click loads roughly one batch
 * of comments (typically ~5-10), so 20 attempts cover up to ~100-200
 * comments — well past any practical organic-engagement target.
 */
const MAX_LOAD_MORE_ATTEMPTS = 20;

/**
 * Map from reaction type to its popup-button selector for the
 * comment-level reactions popup (LinkedIn React/SDUI stack).
 *
 * **History**: Previously the comment-level popup used aria-labels like
 * `"React Like to {Name}'s comment"` (Ember stack).  After the React/SDUI
 * rewrite (verified 2026-05-06, see
 * `research/linkedin/post-detail-comment-dom-react-sdui-20260506.md`)
 * clicking `Open reactions menu` on a comment opens the SAME page-level
 * popup that `react-to-post` uses, so the bare `aria-label="Like"` /
 * `aria-label="Celebrate"` / etc. selectors apply directly.
 *
 * Verified live via `comment-dom-spike.e2e.test.ts` reactions-popup probe
 * (lhremote#776).
 */
const COMMENT_POPUP_REACTION_SELECTORS: Readonly<Record<ReactionType, string>> = {
  like: 'button[aria-label="Like"]',
  celebrate: 'button[aria-label="Celebrate"]',
  support: 'button[aria-label="Support"]',
  love: 'button[aria-label="Love"]',
  insightful: 'button[aria-label="Insightful"]',
  funny: 'button[aria-label="Funny"]',
};

/** Map from display name (as it appears in aria-labels) to reaction type. */
const REACTION_NAME_MAP: Readonly<Partial<Record<string, ReactionType>>> = {
  like: "like",
  celebrate: "celebrate",
  support: "support",
  love: "love",
  insightful: "insightful",
  funny: "funny",
};

/**
 * Detect the current reaction state of a specific comment by reading
 * the React/SDUI state-display element inside the comment scope.
 *
 * **Stack note**: The Ember stack exposed state via the trigger button's
 * `aria-label` (e.g., `"Unreact Like"`).  The React/SDUI rewrite removed
 * the direct-Like trigger entirely; reaction state now lives in an
 * element with `role="button"` (observed as `<div role="button">` and
 * a sibling `<p role="button">`, both bearing the same text — we match
 * either via the role-based selector).  Its `textContent` follows
 * `"Reaction button state: <X><X>"` — the leading `<X>` is the hidden
 * a11y label, the trailing `<X>` is the visible button face.  When the
 * comment is unreacted, the text reads `"Reaction button state: no reactionLike"`
 * (the trailing `Like` is the prompt shown to invite the user to react).
 *
 * Verified via `comment-dom-spike.e2e.test.ts` inner-button probe
 * (lhremote#776).
 *
 * @returns The current reaction type, or `null` if not reacted.
 */
async function detectCommentReaction(
  client: CDPClient,
  commentScopeSelector: string,
): Promise<ReactionType | null> {
  const text = await client.evaluate<string | null>(
    `(() => {
      const scope = document.querySelector(${JSON.stringify(commentScopeSelector)});
      if (!scope) return null;
      const stateEl = Array.from(scope.querySelectorAll('[role="button"]'))
        .find(el => /Reaction button state:/.test(el.textContent || ''));
      return stateEl ? (stateEl.textContent || '').trim() : null;
    })()`,
  );

  if (!text) return null;

  const match = /Reaction button state:\s*(.+)$/.exec(text);
  const rest = match?.[1]?.trim();
  if (!rest) return null;

  // "no reactionLike" → not reacted
  if (/^no reaction/i.test(rest)) return null;

  // "InsightfulInsightful" → "Insightful" (perfect repetition of the
  // state name).  Detect by checking whether the string is two halves of
  // the same word.
  const half = rest.slice(0, Math.floor(rest.length / 2));
  if (half && rest === half + half) {
    return REACTION_NAME_MAP[half.toLowerCase()] ?? null;
  }

  // Fallback: take the first word (covers single-rendered forms).
  const wordMatch = /^([A-Za-z]+)/.exec(rest);
  const word = wordMatch?.[1];
  if (word) {
    return REACTION_NAME_MAP[word.toLowerCase()] ?? null;
  }

  return null;
}

export interface ReactToCommentInput extends ConnectionOptions {
  /** LinkedIn post URL containing the target comment. */
  readonly postUrl: string;
  /**
   * URN of the target comment (as returned by `get-post`'s
   * `commentUrn` field).  Format:
   * `urn:li:comment:(activity:<postActivityId>,<commentId>)`.
   */
  readonly commentUrn: string;
  /** Reaction type to apply (default: `"like"`). */
  readonly reactionType?: ReactionType | undefined;
  /** Optional humanized mouse for natural cursor movement and clicks. */
  readonly mouse?: HumanizedMouse | null | undefined;
  /** When true, detect the reaction state but do not click. */
  readonly dryRun?: boolean | undefined;
}

export interface ReactToCommentOutput {
  readonly success: true;
  readonly postUrl: string;
  readonly commentUrn: string;
  readonly reactionType: ReactionType;
  /** Whether the comment was already reacted with the requested type (no-op). */
  readonly alreadyReacted: boolean;
  /** The reaction detected on the comment before acting (null if none). */
  readonly currentReaction: ReactionType | null;
  readonly dryRun: boolean;
}

/**
 * React to a specific LinkedIn comment with a specified reaction type.
 *
 * Navigates to the parent post URL in the LinkedIn WebView, locates the
 * target comment by its URN (`article[data-id="${commentUrn}"]`), and
 * inspects the comment-scoped reaction trigger's `aria-label` to detect
 * the current reaction state:
 *
 * - **Not reacted**: hovers the trigger to expand the reactions popup,
 *   then clicks the requested reaction button.
 * - **Already reacted with the same type**: returns immediately as a
 *   no-op (`alreadyReacted: true`).
 * - **Already reacted with a different type**: clicks the trigger to
 *   remove the existing reaction, then applies the requested one.
 *
 * When `dryRun` is `true`, the operation navigates to the post, locates
 * the comment, detects the current reaction state, and validates that
 * the reaction popup opens, but skips the final reaction click.
 *
 * Mirrors {@link reactToPost} semantics, scoped to a specific comment
 * via the `commentUrn` parameter.
 *
 * @param input - Post URL, comment URN, reaction type, and CDP connection parameters.
 * @returns Confirmation of the reaction applied, including whether the
 *   comment was already reacted with the requested type.
 */
export async function reactToComment(
  input: ReactToCommentInput,
): Promise<ReactToCommentOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const reactionType = input.reactionType ?? "like";
  const dryRun = input.dryRun ?? false;

  if (!REACTION_TYPES.includes(reactionType)) {
    throw new Error(
      `Invalid reaction type "${reactionType}". ` +
        `Valid types: ${REACTION_TYPES.join(", ")}`,
    );
  }

  // Validate post URL format
  if (!LINKEDIN_POST_URL_RE.test(input.postUrl)) {
    throw new Error(
      `Invalid LinkedIn post URL: ${input.postUrl}. ` +
        "Expected a URL like https://www.linkedin.com/feed/update/urn:li:activity:... " +
        "or https://www.linkedin.com/posts/...",
    );
  }

  // Validate comment URN format
  if (!COMMENT_URN_RE.test(input.commentUrn)) {
    throw new Error(
      `Invalid comment URN: ${input.commentUrn}. ` +
        "Expected format: urn:li:comment:(activity:1234567890,9876543210)",
    );
  }

  // Enforce loopback guard
  if (!allowRemote && cdpHost !== "127.0.0.1" && cdpHost !== "localhost") {
    throw new Error(
      `Non-loopback CDP host "${cdpHost}" requires --allow-remote. ` +
        "This is a security measure to prevent remote code execution.",
    );
  }

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
    // Force a fresh navigation if we're already on a post detail page —
    // LinkedIn's SPA otherwise short-circuits same-route navigations and
    // leaves the comments section stale.  Mirrors `get-post.ts:439`.
    await navigateAwayIf(client, "/feed/update/");
    await navigateAwayIf(client, "/posts/");

    // Navigate to the post URL and wait for the page load event so the
    // comment article is actually present before we try to find it.
    // Without the explicit load wait, `client.navigate` returns when the
    // navigation is *initiated* — the article DOM is then a race.
    await client.send("Page.enable");
    try {
      const loadPromise = client.waitForEvent("Page.loadEventFired");
      await client.navigate(input.postUrl);
      await loadPromise;
    } finally {
      await client.send("Page.disable").catch(() => {});
    }

    const mouse = input.mouse;

    // Normalize URN to React-stack format (legacy callers pass
    // `urn:li:comment:(activity:N,M)`; the SDUI DOM uses
    // `urn:li:comment:(urn:li:activity:N,M)`).  Use the normalized URN
    // for all DOM lookups; preserve `input.commentUrn` for output / error
    // messages so callers see what they passed in.
    const normalizedUrn = normalizeCommentUrnForReactStack(input.commentUrn);

    // Wait for the comments section to render at least one comment.
    // Without this anchor, looking up a specific componentkey races the
    // comments-section's lazy hydration: the post body lands first,
    // comments arrive later as a JS-fetched batch.  Mirrors the pattern
    // that `comment-on-post.ts` benefits from implicitly via
    // `waitForElement(COMMENT_INPUT)`.
    await waitForElement(client, COMMENT_ARTICLE_ANY, undefined, mouse);

    // Locate the target comment — it may not be in the initial batch on
    // a post with many comments (LinkedIn shows ~3-5 by default and
    // paginates the rest behind a "Load more comments" button).  Click
    // the load-more button repeatedly until the specific URN is
    // reachable, or until no more load-more buttons remain.
    //
    // The React/SDUI stack identifies each comment by
    // `componentkey="replaceableComment_<URN>"` (three nested elements
    // share the same value — the selector matches all three, which is
    // fine for descendant queries).  See
    // `research/linkedin/post-detail-comment-dom-react-sdui-20260506.md`
    // and lhremote#776.
    const articleSelector = commentArticleSelectorByUrn(normalizedUrn);
    let articleFound = false;
    for (let attempt = 0; attempt <= MAX_LOAD_MORE_ATTEMPTS; attempt++) {
      const isPresent = await client.evaluate<boolean>(`(() => {
        return document.querySelector(${JSON.stringify(articleSelector)}) !== null;
      })()`);
      if (isPresent) {
        articleFound = true;
        break;
      }
      const clicked = await client.evaluate<boolean>(CLICK_LOAD_MORE_COMMENTS_SCRIPT);
      if (!clicked) break;
      // Brief settle delay between paginated loads
      await gaussianDelay(1_500, 200, 1_000, 2_000);
    }

    if (!articleFound) {
      throw new Error(
        `Comment ${input.commentUrn} not found on post ${input.postUrl} ` +
          `after ${MAX_LOAD_MORE_ATTEMPTS} "Load more comments" attempts. ` +
          "Verify the URN matches a comment on this post.",
      );
    }

    await waitForElement(client, articleSelector, undefined, mouse);
    await humanizedScrollTo(client, articleSelector, mouse);

    // React/SDUI stack: the comment exposes ONE reaction-related button
    // (the menu opener) and a state-display element.  The legacy
    // "state-bearing direct-Like trigger" is gone — every reaction now
    // goes through the popup, and switching reactions is a single click
    // on the new reaction in the popup (LinkedIn auto-replaces the
    // existing one).  See lhremote#776 and
    // `research/linkedin/post-detail-comment-dom-react-sdui-20260506.md`.
    const menuSelector = `${articleSelector} ${COMMENT_REACTIONS_MENU}`;
    await waitForElement(client, menuSelector, undefined, mouse);

    // Detect existing reaction state from the role="button" state element.
    const currentReaction = await detectCommentReaction(client, articleSelector);

    if (currentReaction === reactionType) {
      // Already reacted with the requested type — no-op
      await gaussianDelay(1_500, 500, 700, 3_500); // Post-action dwell
      return {
        success: true as const,
        postUrl: input.postUrl,
        commentUrn: input.commentUrn,
        reactionType,
        alreadyReacted: true,
        currentReaction,
        dryRun,
      };
    }

    // Apply / switch reaction.  In the React/SDUI stack the popup is
    // CLICK-anchored on the menu button (verified via spike — hover
    // alone does not open it; humanizedClick does).  But the popup is
    // also fragile: humanizedClick on the popup button takes ~500ms
    // (viewport scroll + multi-step humanized mouse motion + pre-hover
    // pause), and the popup closes mid-motion before the click lands —
    // observed as "Element button[aria-label=\"Like\"] not found for click".
    //
    // Workaround: open the menu via humanizedClick (fine — single click,
    // mouse stays put), then dispatch the reaction via the lightweight
    // synchronous JS click() helper (one CDP roundtrip, no mouse motion).
    //
    // The popup buttons are PAGE-LEVEL (not scoped to the comment) —
    // clicking the menu re-positions the same shared popup anchored on
    // the comment.  Selectors come from COMMENT_POPUP_REACTION_SELECTORS
    // (bare aria-label="<Type>").
    const popupReactionSelector = COMMENT_POPUP_REACTION_SELECTORS[reactionType];
    await retryInteraction(async () => {
      await humanizedClick(client, menuSelector, mouse);
      await gaussianDelay(800, 200, 500, 1_500);
      await waitForElement(client, popupReactionSelector, { timeout: 10_000 });
    }, 3);

    if (!dryRun) {
      await click(client, popupReactionSelector);
      await gaussianDelay(550, 75, 400, 700);
      // After applying, give the DOM time to settle (the state element
      // text updates to reflect the new reaction).
      await waitForDOMStable(client, 300);
    } else {
      // Dry-run: dismiss the popup we just opened so we leave the page
      // visually clean.
      await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    }

    await gaussianDelay(1_500, 500, 700, 3_500); // Post-action dwell
    return {
      success: true as const,
      postUrl: input.postUrl,
      commentUrn: input.commentUrn,
      reactionType,
      alreadyReacted: false,
      currentReaction,
      dryRun,
    };
  } finally {
    client.disconnect();
  }
}
