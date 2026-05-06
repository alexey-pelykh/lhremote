// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { ActionBudgetRepository } from "../db/index.js";
import { waitForElement, humanizedScrollTo, humanizedClick, typeText, typeTextWithMentions } from "../linkedin/dom-automation.js";
import type { MentionEntry } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import {
  commentArticleSelectorByUrn,
  COMMENT_INPUT,
  COMMENT_REPLY_BUTTON,
  COMMENT_SUBMIT_BUTTON,
  normalizeCommentUrnForReactStack,
} from "../linkedin/selectors.js";
import { resolveAccount } from "../services/account-resolution.js";
import { BudgetExceededError } from "../services/errors.js";
import { withDatabase } from "../services/instance-context.js";
import { gaussianDelay } from "../utils/delay.js";
import { buildCdpOptions, type ConnectionOptions } from "./types.js";

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
 * `normalizeCommentUrnForReactStack` converts to the React-stack form
 * before DOM lookups.  See lhremote#776 and
 * `research/linkedin/post-detail-comment-dom-react-sdui-20260506.md`.
 */
const COMMENT_URN_RE = /^urn:li:comment:\((?:urn:li:)?\w+:\d+,\d+\)$/;

/** Limit type ID for PostComment in the LinkedHelper budget system. */
const POST_COMMENT_LIMIT_TYPE_ID = 19;

/**
 * Input for the comment-on-post operation.
 */
export interface CommentOnPostInput extends ConnectionOptions {
  /** LinkedIn post URL (e.g. `https://www.linkedin.com/feed/update/urn:li:activity:1234567890/`). */
  readonly postUrl: string;
  /** Comment text to post. */
  readonly text: string;
  /**
   * When provided, the comment is posted as a reply to the specified
   * comment instead of as a top-level comment.  The URN comes from
   * the `commentUrn` field in `get-post` output (e.g.
   * `urn:li:comment:(activity:1234567890,9876543210)`).
   */
  readonly parentCommentUrn?: string | undefined;
  /**
   * People to @mention in the comment.  Each entry's `name` must
   * appear as a literal `@Name` token in {@link text}.  During typing,
   * each `@Name` triggers LinkedIn's mention autocomplete and selects
   * the matching profile.
   */
  readonly mentions?: readonly MentionEntry[] | undefined;
  /** Optional humanized mouse for natural cursor movement and clicks. */
  readonly mouse?: HumanizedMouse | null | undefined;
  /** When true, validate the comment flow but skip typing and clicking submit. */
  readonly dryRun?: boolean | undefined;
}

/**
 * Output from the comment-on-post operation.
 */
export interface CommentOnPostOutput {
  readonly success: true;
  readonly postUrl: string;
  readonly commentText: string;
  /** The parent comment URN when this was posted as a reply, or `null` for top-level comments. */
  readonly parentCommentUrn: string | null;
  readonly dryRun: boolean;
}

/**
 * Post a comment on a LinkedIn post.
 *
 * Navigates the LinkedIn webview to the post URL, finds the comment
 * input via selectors, types the comment text character-by-character
 * for human-like behaviour, and clicks submit.
 *
 * When {@link CommentOnPostInput.dryRun | dryRun} is `true`, the
 * operation validates that the comment input and submit button are
 * present but skips typing and clicking submit.
 *
 * Checks the action budget before attempting the comment and fails
 * with a {@link BudgetExceededError} if the PostComment limit has
 * been reached.
 *
 * @param input - Post URL, comment text, and CDP connection parameters.
 * @returns Success status with the posted comment data.
 */
export async function commentOnPost(
  input: CommentOnPostInput,
): Promise<CommentOnPostOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;

  if (!input.text.trim()) {
    throw new Error("Comment text cannot be empty");
  }

  // Validate post URL format
  if (!LINKEDIN_POST_URL_RE.test(input.postUrl)) {
    throw new Error(
      `Invalid LinkedIn post URL: ${input.postUrl}. ` +
        "Expected a URL like https://www.linkedin.com/feed/update/urn:li:activity:... " +
        "or https://www.linkedin.com/posts/...",
    );
  }

  // Validate comment URN format when provided
  if (input.parentCommentUrn !== undefined && !COMMENT_URN_RE.test(input.parentCommentUrn)) {
    throw new Error(
      `Invalid comment URN: ${input.parentCommentUrn}. ` +
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

  // Check action budget before attempting the comment
  const accountId = await resolveAccount(cdpPort, buildCdpOptions(input));

  await withDatabase(accountId, ({ db }) => {
    const repo = new ActionBudgetRepository(db);
    const entries = repo.getActionBudget();
    const entry = entries.find(
      (e) => e.limitTypeId === POST_COMMENT_LIMIT_TYPE_ID,
    );
    if (entry && entry.remaining !== null && entry.remaining <= 0) {
      throw new BudgetExceededError(
        entry.limitType,
        entry.dailyLimit ?? 0,
        entry.totalUsed,
      );
    }
  });

  // Connect to the LinkedIn webview
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
    // Navigate to the post URL
    await client.send("Page.enable");
    try {
      const loadPromise = client.waitForEvent("Page.loadEventFired");
      await client.navigate(input.postUrl);
      await loadPromise;
    } finally {
      await client.send("Page.disable").catch(() => {});
    }

    const mouse = input.mouse;
    const parentUrn = input.parentCommentUrn;
    const mentions = input.mentions ?? [];
    const dryRun = input.dryRun ?? false;

    if (parentUrn) {
      // --- Reply to a specific comment ---
      // React/SDUI stack: each comment is a `<div componentkey="replaceableComment_<URN>">`,
      // not the legacy `<article class="comments-comment-entity" data-id="<URN>">`.
      // Normalize the URN to the SDUI form (legacy callers pass
      // `urn:li:comment:(activity:N,M)`; SDUI uses
      // `urn:li:comment:(urn:li:activity:N,M)`).  See lhremote#776.
      const normalizedParentUrn = normalizeCommentUrnForReactStack(parentUrn);
      const commentSelector = commentArticleSelectorByUrn(normalizedParentUrn);
      await waitForElement(client, commentSelector, undefined, mouse);
      await humanizedScrollTo(client, commentSelector, mouse);

      // The Reply button has no aria-label in the React/SDUI stack — it's
      // identified only by its `textContent === "Reply"`.  Stamp a marker
      // attribute via JS so we can use a CSS selector for the subsequent
      // wait/click flow.  Falls back to the legacy `aria-label^="Reply to "`
      // if the marker stamp couldn't find a Reply button (covers any
      // residual Ember-stack pages or future re-skin).
      const replyMarkerStamped = await client.evaluate<boolean>(`(() => {
        const scope = document.querySelector(${JSON.stringify(commentSelector)});
        if (!scope) return false;
        const btn = Array.from(scope.querySelectorAll('button'))
          .find(b => (b.textContent || '').trim() === 'Reply');
        if (!btn) return false;
        btn.setAttribute('data-lhremote-reply', '1');
        return true;
      })()`);

      const replySelector = replyMarkerStamped
        ? `${commentSelector} button[data-lhremote-reply="1"]`
        : `${commentSelector} ${COMMENT_REPLY_BUTTON}`;
      await waitForElement(client, replySelector, undefined, mouse);
      await humanizedClick(client, replySelector, mouse);
      await gaussianDelay(550, 75, 400, 700);

      // After clicking Reply, LinkedIn focuses the reply editor.
      // Wait for a focused COMMENT_INPUT to avoid matching the
      // pre-existing top-level comment input.
      await waitForElement(client, `${COMMENT_INPUT}:focus`, undefined, mouse);
      await gaussianDelay(350, 50, 250, 500);

      if (!dryRun) {
        if (mentions.length > 0) {
          await typeTextWithMentions(client, `${COMMENT_INPUT}:focus`, input.text, mentions);
        } else {
          await typeText(client, `${COMMENT_INPUT}:focus`, input.text);
        }
      }
    } else {
      // --- Top-level comment ---
      await waitForElement(client, COMMENT_INPUT, undefined, mouse);
      await humanizedScrollTo(client, COMMENT_INPUT, mouse);
      await humanizedClick(client, COMMENT_INPUT, mouse);
      await gaussianDelay(550, 75, 400, 700);

      if (!dryRun) {
        if (mentions.length > 0) {
          await typeTextWithMentions(client, COMMENT_INPUT, input.text, mentions);
        } else {
          await typeText(client, COMMENT_INPUT, input.text);
        }
      }
    }

    // Wait for submit button to validate the submit flow would work
    await waitForElement(client, COMMENT_SUBMIT_BUTTON, undefined, mouse);

    if (!dryRun) {
      await humanizedClick(client, COMMENT_SUBMIT_BUTTON, mouse);

      // Brief wait for the comment to post
      await gaussianDelay(2_000, 250, 1_500, 2_500);
    }

    await gaussianDelay(1_500, 500, 700, 3_500); // Post-action dwell
    return {
      success: true as const,
      postUrl: input.postUrl,
      commentText: input.text,
      parentCommentUrn: parentUrn ?? null,
      dryRun,
    };
  } finally {
    client.disconnect();
  }
}
