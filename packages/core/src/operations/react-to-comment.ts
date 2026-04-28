// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import {
  humanizedClick,
  humanizedScrollTo,
  retryInteraction,
  waitForDOMStable,
  waitForElement,
} from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import {
  COMMENT_REACTION_TRIGGER,
  COMMENT_REACTIONS_MENU,
} from "../linkedin/selectors.js";
import { gaussianDelay } from "../utils/delay.js";
import { navigateAwayIf } from "./navigate-away.js";
import { REACTION_TYPES, type ReactionType } from "./react-to-post.js";
import type { ConnectionOptions } from "./types.js";

/** Pattern matching supported LinkedIn post URL formats. */
const LINKEDIN_POST_URL_RE =
  /linkedin\.com\/(?:feed\/update\/urn:li:\w+:\d+|posts\/[^/]+)/;

/** Pattern matching a LinkedIn comment URN (e.g. `urn:li:comment:(activity:123,456)`). */
const COMMENT_URN_RE = /^urn:li:comment:\(\w+:\d+,\d+\)$/;

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
 * comment-level reactions popup.
 *
 * **Important**: comment-level popup buttons have aria-labels of the form
 * `"React {Type} to {Name}'s comment"` — distinct from the post-level
 * popup which uses bare `"React Like"` / `"Like"` / etc.  The post-level
 * REACTION_LIKE/CELEBRATE/etc. constants do NOT match here.
 *
 * Discovered via E2E diagnostic capture against the LinkedHelper webview
 * (lhremote#754).  See `../research/linkedin/comment-reactions-dom-20260428.md`.
 */
const COMMENT_POPUP_REACTION_SELECTORS: Readonly<Record<ReactionType, string>> = {
  like: 'button[aria-label^="React Like to "]',
  celebrate: 'button[aria-label^="React Celebrate to "]',
  support: 'button[aria-label^="React Support to "]',
  love: 'button[aria-label^="React Love to "]',
  insightful: 'button[aria-label^="React Insightful to "]',
  funny: 'button[aria-label^="React Funny to "]',
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
 * Detect the current reaction state of a specific comment by inspecting
 * the comment-scoped reaction trigger button's `aria-label`.
 *
 * The expected aria-label patterns on the post detail page (Ember stack):
 *
 * - Not reacted: `"React Like to {Name}'s comment"`
 * - Reacted:    `"Unreact Like"` or `"Unreact Like to {Name}'s comment"`
 *               (and equivalent for Celebrate / Support / Love / Insightful / Funny)
 *
 * Uses the same `^Unreact\s+(\w+)` regex as the post-level detector;
 * the `\w+` capture takes only the first word, so it correctly handles
 * both the bare `"Unreact Like"` form and the comment-context-preserving
 * `"Unreact Like to {Name}'s comment"` form.
 *
 * @returns The current reaction type, or `null` if not reacted.
 */
async function detectCommentReaction(
  client: CDPClient,
  scopedTriggerSelector: string,
): Promise<ReactionType | null> {
  const label = await client.evaluate<string | null>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(scopedTriggerSelector)});
      return el ? el.getAttribute('aria-label') : null;
    })()`,
  );

  if (!label) return null;

  // Reacted: "Unreact Like" / "Unreact Like to {Name}'s comment", etc.
  const unreactMatch = /^Unreact\s+(\w+)/i.exec(label);
  if (unreactMatch?.[1]) {
    return REACTION_NAME_MAP[unreactMatch[1].toLowerCase()] ?? null;
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

    // Wait for the comments section to render at least one comment.
    // Without this anchor, looking up a specific `article[data-id="..."]`
    // races the comments-section's lazy hydration: the post body lands
    // first, comments arrive later as a JS-fetched batch.  Mirrors the
    // pattern that `comment-on-post.ts` benefits from implicitly via
    // `waitForElement(COMMENT_INPUT)` (its reply test runs after a
    // top-level comment-on-post test that already triggered hydration).
    await waitForElement(client, "article.comments-comment-entity", undefined, mouse);

    // Locate the target comment article — it may not be in the initial
    // batch on a post with many comments (LinkedIn shows ~3-5 by default
    // and paginates the rest behind a "Load more comments" button).
    // Click the load-more button repeatedly until the specific URN is
    // reachable, or until no more load-more buttons remain.
    // CSS attribute selectors with parentheses and colons in the value
    // (e.g., `article[data-id="urn:li:comment:(activity:N,M)"]`) are
    // technically valid CSS3, but the LinkedIn Electron webview has
    // intermittent issues matching them via `querySelector`.  We use
    // JS-side equality (`getAttribute('data-id') === target`) for
    // presence checks and CSS-attribute scoping; the latter is fine
    // for `:scope` searches inside the article once the element is
    // found, but for *finding* the article we use a `data-comment-urn`
    // marker stamped onto the element so subsequent scoped queries
    // ride a clean attribute selector.
    const articleSelector = `article[data-comment-urn="${input.commentUrn}"]`;
    let articleFound = false;
    for (let attempt = 0; attempt <= MAX_LOAD_MORE_ATTEMPTS; attempt++) {
      const isPresent = await client.evaluate<boolean>(`(() => {
        const target = ${JSON.stringify(input.commentUrn)};
        const article = Array.from(document.querySelectorAll('article[data-id]'))
          .find(a => a.getAttribute('data-id') === target);
        if (!article) return false;
        // Stamp a marker so subsequent CSS attribute selectors can find it
        // without depending on parens/colons being parsed correctly.
        article.setAttribute('data-comment-urn', target);
        return true;
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

    // Two distinct comment-scoped buttons (see selectors.ts):
    //   - triggerSelector: state-bearing direct-Like button, used for
    //     reading current reaction and unreacting an existing one.
    //   - menuSelector:    popup-opening button, hovered/clicked to
    //     expand the 6-reaction picker.
    const triggerSelector = `${articleSelector} ${COMMENT_REACTION_TRIGGER}`;
    const menuSelector = `${articleSelector} ${COMMENT_REACTIONS_MENU}`;
    await waitForElement(client, triggerSelector, undefined, mouse);

    // Detect existing reaction state from the trigger's aria-label
    const currentReaction = await detectCommentReaction(client, triggerSelector);

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

    if (!dryRun && currentReaction !== null) {
      // Reacted with a different type — click the state-bearing trigger
      // to unreact first.  Clicking the trigger when its aria-label is
      // "Unreact {Type} to ..." toggles the existing reaction off.
      await humanizedClick(client, triggerSelector, mouse);
      // Wait for DOM to settle after unreacting — the trigger element's
      // aria-label changes back to "React Like to ...".
      await waitForDOMStable(client, 300);
    }

    // Apply the new reaction.
    //
    // For the "like" reaction specifically, the state-bearing direct-Like
    // button (COMMENT_REACTION_TRIGGER) IS the apply mechanism — clicking
    // it when in unreacted state applies a Like.  No popup needed.
    //
    // For the 5 non-Like reactions, we must open the reactions popup
    // (COMMENT_REACTIONS_MENU) via a CLICK (not hover, unlike post-level)
    // and then click the popup button.  Comment-level popup buttons have
    // aria-labels "React {Type} to {Name}'s comment" — distinct from the
    // post-level bare "React {Type}" / "{Type}" pattern.
    if (reactionType === "like") {
      if (!dryRun) {
        await humanizedClick(client, triggerSelector, mouse);
        await gaussianDelay(550, 75, 400, 700);
      }
    } else {
      const popupReactionSelector = COMMENT_POPUP_REACTION_SELECTORS[reactionType];
      await retryInteraction(async () => {
        await humanizedClick(client, menuSelector, mouse);
        await gaussianDelay(800, 200, 500, 1_500);
        await waitForElement(client, popupReactionSelector, { timeout: 10_000 });
      }, 3);

      if (!dryRun) {
        await humanizedClick(client, popupReactionSelector, mouse);
        await gaussianDelay(550, 75, 400, 700);
      }
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
