// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  errorMessage,
  reactToComment,
  type ReactToCommentOutput,
  type ReactionType,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#react-to-comment | react-to-comment} CLI command. */
export async function handleReactToComment(
  postUrl: string,
  commentUrn: string,
  options: {
    type?: string;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    dryRun?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: ReactToCommentOutput;
  try {
    result = await reactToComment({
      postUrl,
      commentUrn,
      reactionType: (options.type as ReactionType | undefined),
      cdpPort: options.cdpPort,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
      dryRun: options.dryRun,
    });
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (result.dryRun) {
    if (result.alreadyReacted) {
      process.stdout.write(
        `[dry-run] Already reacted to comment with "${result.reactionType}" (no change)\n` +
          `  Post:    ${result.postUrl}\n` +
          `  Comment: ${result.commentUrn}\n`,
      );
    } else {
      process.stdout.write(
        `[dry-run] Would react to comment with "${result.reactionType}"\n` +
          `  Post:    ${result.postUrl}\n` +
          `  Comment: ${result.commentUrn}\n`,
      );
    }
  } else if (result.alreadyReacted) {
    process.stdout.write(
      `Already reacted to comment with "${result.reactionType}" (no change)\n` +
        `  Post:    ${result.postUrl}\n` +
        `  Comment: ${result.commentUrn}\n`,
    );
  } else {
    process.stdout.write(
      `Reacted to comment with "${result.reactionType}"\n` +
        `  Post:    ${result.postUrl}\n` +
        `  Comment: ${result.commentUrn}\n`,
    );
  }
}
