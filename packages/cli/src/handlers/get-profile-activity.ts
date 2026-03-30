// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  errorMessage,
  getProfileActivity,
  type GetProfileActivityOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#get-profile-activity | get-profile-activity} CLI command. */
export async function handleGetProfileActivity(
  profile: string,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    count?: number;
    cursor?: string;
    json?: boolean;
  },
): Promise<void> {
  let result: GetProfileActivityOutput;
  try {
    result = await getProfileActivity({
      profile,
      cdpPort: options.cdpPort,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
      count: options.count,
      cursor: options.cursor,
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
    process.stdout.write(`Profile: ${result.profilePublicId}\n\n`);

    for (const post of result.posts) {
      if (post.url) {
        process.stdout.write(`  ${post.url}\n`);
      }
      if (post.authorName) {
        process.stdout.write(`    Author:    ${post.authorName}\n`);
      }
      if (post.timestamp) {
        process.stdout.write(
          `    Published: ${new Date(post.timestamp).toISOString()}\n`,
        );
      }
      if (post.text) {
        const preview =
          post.text.length > 120
            ? post.text.slice(0, 120) + "..."
            : post.text;
        process.stdout.write(`    Text:      ${preview}\n`);
      }
      process.stdout.write(
        `    Reactions: ${String(post.reactionCount)}  ` +
          `Comments: ${String(post.commentCount)}  ` +
          `Shares: ${String(post.shareCount)}\n`,
      );
      if (post.url) {
        process.stdout.write(`    URL:       ${post.url}\n`);
      }
      process.stdout.write("\n");
    }

    if (result.posts.length === 0) {
      process.stdout.write("  (no posts found)\n");
    }

    if (result.nextCursor) {
      process.stdout.write(`Next cursor: ${result.nextCursor}\n`);
    }
  }
}
