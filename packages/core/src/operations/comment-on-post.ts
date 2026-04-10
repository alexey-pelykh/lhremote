// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { ActionBudgetRepository } from "../db/index.js";
import { waitForElement, humanizedScrollTo, humanizedClick, typeText, typeTextWithMentions } from "../linkedin/dom-automation.js";
import type { MentionEntry } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { COMMENT_INPUT, COMMENT_REPLY_BUTTON, COMMENT_SUBMIT_BUTTON } from "../linkedin/selectors.js";
import { resolveAccount } from "../services/account-resolution.js";
import { BudgetExceededError } from "../services/errors.js";
import { withDatabase } from "../services/instance-context.js";
import { gaussianDelay } from "../utils/delay.js";
import { buildCdpOptions, type ConnectionOptions } from "./types.js";

/** Pattern matching supported LinkedIn post URL formats. */
const LINKEDIN_POST_URL_RE =
  /linkedin\.com\/(?:feed\/update\/urn:li:\w+:\d+|posts\/[^/]+)/;

/** Pattern matching a LinkedIn comment URN (e.g. `urn:li:comment:(activity:123,456)`). */
const COMMENT_URN_RE = /^urn:li:comment:\(\w+:\d+,\d+\)$/;

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
  /** When true, prepare the comment but do not click submit. */
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
      // Find the target comment article by its data-id attribute
      const commentSelector = `article[data-id="${parentUrn}"]`;
      await waitForElement(client, commentSelector, undefined, mouse);
      await humanizedScrollTo(client, commentSelector, mouse);

      // Click the Reply button within that comment
      const replySelector = `${commentSelector} ${COMMENT_REPLY_BUTTON}`;
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

    if (!dryRun) {
      // Wait for submit button and click
      await waitForElement(client, COMMENT_SUBMIT_BUTTON, undefined, mouse);
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
