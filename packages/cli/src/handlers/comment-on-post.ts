// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  BudgetExceededError,
  errorMessage,
  commentOnPost,
  type CommentOnPostOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#comment-on-post | comment-on-post} CLI command. */
export async function handleCommentOnPost(options: {
  url: string;
  text: string;
  parentCommentUrn?: string;
  cdpPort?: number;
  cdpHost?: string;
  allowRemote?: boolean;
  accountId?: number;
  json?: boolean;
}): Promise<void> {
  process.stderr.write(
    options.parentCommentUrn ? "Posting reply...\n" : "Posting comment...\n",
  );

  let result: CommentOnPostOutput;
  try {
    result = await commentOnPost({
      postUrl: options.url,
      text: options.text,
      parentCommentUrn: options.parentCommentUrn,
      cdpPort: options.cdpPort,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
      accountId: options.accountId,
    });
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stderr.write("Done.\n");

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (result.parentCommentUrn) {
      process.stdout.write(`Reply posted on ${result.postUrl}\n`);
      process.stdout.write(`In reply to: ${result.parentCommentUrn}\n`);
    } else {
      process.stdout.write(`Comment posted on ${result.postUrl}\n`);
    }
    process.stdout.write(`Text: ${result.commentText}\n`);
  }
}
