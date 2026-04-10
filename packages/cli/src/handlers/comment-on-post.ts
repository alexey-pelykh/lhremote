// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  BudgetExceededError,
  errorMessage,
  commentOnPost,
  type CommentOnPostOutput,
  type MentionEntry,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#comment-on-post | comment-on-post} CLI command. */
export async function handleCommentOnPost(options: {
  url: string;
  text: string;
  parentCommentUrn?: string;
  mentions?: string;
  cdpPort?: number;
  cdpHost?: string;
  allowRemote?: boolean;
  accountId?: number;
  dryRun?: boolean;
  json?: boolean;
}): Promise<void> {
  process.stderr.write(
    options.parentCommentUrn ? "Posting reply...\n" : "Posting comment...\n",
  );

  let parsedMentions: MentionEntry[] | undefined;
  if (options.mentions) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.mentions);
    } catch {
      process.stderr.write(
        'Invalid --mentions JSON. Expected array of {name} objects (e.g. \'[{"name":"John Doe"}]\')\n',
      );
      process.exitCode = 1;
      return;
    }
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (item: unknown) =>
          typeof item === "object" &&
          item !== null &&
          "name" in item &&
          typeof (item as { name: unknown }).name === "string" &&
          (item as { name: string }).name.length > 0,
      )
    ) {
      process.stderr.write(
        'Invalid --mentions structure. Expected array of {name} objects with non-empty string names (e.g. \'[{"name":"John Doe"}]\')\n',
      );
      process.exitCode = 1;
      return;
    }
    parsedMentions = parsed as MentionEntry[];
  }

  let result: CommentOnPostOutput;
  try {
    result = await commentOnPost({
      postUrl: options.url,
      text: options.text,
      parentCommentUrn: options.parentCommentUrn,
      mentions: parsedMentions,
      cdpPort: options.cdpPort,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
      accountId: options.accountId,
      dryRun: options.dryRun,
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
  } else if (result.dryRun) {
    if (result.parentCommentUrn) {
      process.stdout.write(
        `[dry-run] Would post reply on ${result.postUrl}\n` +
          `In reply to: ${result.parentCommentUrn}\n` +
          `Text: ${result.commentText}\n`,
      );
    } else {
      process.stdout.write(
        `[dry-run] Would post comment on ${result.postUrl}\n` +
          `Text: ${result.commentText}\n`,
      );
    }
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
