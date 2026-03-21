// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import { ActionBudgetRepository } from "../db/index.js";
import { waitForElement, scrollTo, click, typeText } from "../linkedin/dom-automation.js";
import { COMMENT_INPUT, COMMENT_SUBMIT_BUTTON } from "../linkedin/selectors.js";
import { resolveAccount } from "../services/account-resolution.js";
import { BudgetExceededError } from "../services/errors.js";
import { withDatabase } from "../services/instance-context.js";
import { delay } from "../utils/delay.js";
import type { ConnectionOptions } from "./types.js";

/** Pattern matching supported LinkedIn post URL formats. */
const LINKEDIN_POST_URL_RE =
  /linkedin\.com\/(?:feed\/update\/urn:li:\w+:\d+|posts\/[^/]+)/;

/** Limit type ID for PostComment in the LinkedHelper budget system. */
const POST_COMMENT_LIMIT_TYPE_ID = 19;

/** Delay after clicking the comment input to let the editor expand (ms). */
const EDITOR_EXPAND_DELAY = 500;

/** Delay after clicking submit to let the comment post (ms). */
const POST_SUBMIT_DELAY = 2000;

/**
 * Input for the comment-on-post operation.
 */
export interface CommentOnPostInput extends ConnectionOptions {
  /** LinkedIn post URL (e.g. `https://www.linkedin.com/feed/update/urn:li:activity:1234567890/`). */
  readonly postUrl: string;
  /** Comment text to post. */
  readonly text: string;
}

/**
 * Output from the comment-on-post operation.
 */
export interface CommentOnPostOutput {
  readonly success: boolean;
  readonly postUrl: string;
  readonly commentText: string;
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
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
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

  // Enforce loopback guard
  if (!allowRemote && cdpHost !== "127.0.0.1" && cdpHost !== "localhost") {
    throw new Error(
      `Non-loopback CDP host "${cdpHost}" requires --allow-remote. ` +
        "This is a security measure to prevent remote code execution.",
    );
  }

  // Check action budget before attempting the comment
  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

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

    // Wait for the comment input and interact
    await waitForElement(client, COMMENT_INPUT);
    await scrollTo(client, COMMENT_INPUT);
    await click(client, COMMENT_INPUT);
    await delay(EDITOR_EXPAND_DELAY);

    // Type comment text character-by-character
    await typeText(client, COMMENT_INPUT, input.text);

    // Wait for submit button and click
    await waitForElement(client, COMMENT_SUBMIT_BUTTON);
    await click(client, COMMENT_SUBMIT_BUTTON);

    // Brief wait for the comment to post
    await delay(POST_SUBMIT_DELAY);

    return {
      success: true,
      postUrl: input.postUrl,
      commentText: input.text,
    };
  } finally {
    client.disconnect();
  }
}
