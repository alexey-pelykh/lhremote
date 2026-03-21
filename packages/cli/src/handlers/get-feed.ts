// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  DEFAULT_CDP_PORT,
  errorMessage,
  getFeed,
  type GetFeedOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#get-feed | get-feed} CLI command. */
export async function handleGetFeed(
  options: {
    count?: number;
    cursor?: string;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: GetFeedOutput;
  try {
    result = await getFeed({
      count: options.count,
      cursor: options.cursor,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (result.posts.length === 0) {
      process.stdout.write("No posts found in feed.\n");
    } else {
      for (const post of result.posts) {
        process.stdout.write(`${post.authorName}\n`);
        if (post.authorHeadline) {
          process.stdout.write(`  ${post.authorHeadline}\n`);
        }
        process.stdout.write(`  ${post.url}\n`);
        if (post.text) {
          const truncated =
            post.text.length > 120
              ? post.text.slice(0, 120) + "..."
              : post.text;
          process.stdout.write(`  ${truncated}\n`);
        }
        if (post.mediaType) {
          process.stdout.write(`  Media: ${post.mediaType}\n`);
        }
        process.stdout.write(
          `  Reactions: ${String(post.reactionCount)}` +
            `  Comments: ${String(post.commentCount)}` +
            `  Shares: ${String(post.shareCount)}\n`,
        );
        if (post.hashtags.length > 0) {
          process.stdout.write(
            `  Tags: ${post.hashtags.map((t) => "#" + t).join(", ")}\n`,
          );
        }
        if (post.timestamp) {
          process.stdout.write(
            `  Posted: ${new Date(post.timestamp).toISOString()}\n`,
          );
        }
        process.stdout.write("\n");
      }
    }

    if (result.nextCursor) {
      process.stdout.write(`Next cursor: ${result.nextCursor}\n`);
    }
  }
}
