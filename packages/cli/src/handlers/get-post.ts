// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  DEFAULT_CDP_PORT,
  errorMessage,
  getPost,
  type GetPostOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#get-post | get-post} CLI command. */
export async function handleGetPost(
  postUrl: string,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    commentCount?: number;
    json?: boolean;
  },
): Promise<void> {
  let result: GetPostOutput;
  try {
    result = await getPost({
      postUrl,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
      commentCount: options.commentCount,
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
    const { post, comments, commentsPaging } = result;

    process.stdout.write(`Post: ${post.postUrn}\n`);
    if (post.authorName) {
      process.stdout.write(`Author: ${post.authorName}`);
      if (post.authorHeadline) {
        process.stdout.write(` — ${post.authorHeadline}`);
      }
      process.stdout.write("\n");
    }
    if (post.publishedAt) {
      process.stdout.write(
        `Published: ${new Date(post.publishedAt).toISOString()}\n`,
      );
    }
    process.stdout.write("\n");

    if (post.text) {
      process.stdout.write(`${post.text}\n\n`);
    }

    process.stdout.write(`  Reactions: ${String(post.reactionCount)}\n`);
    process.stdout.write(`  Comments:  ${String(post.commentCount)}\n`);
    process.stdout.write(`  Shares:    ${String(post.shareCount)}\n`);

    if (comments.length > 0) {
      process.stdout.write(
        `\nComments (${String(commentsPaging.start + 1)}–${String(commentsPaging.start + comments.length)} of ${String(commentsPaging.total)}):\n`,
      );
      for (const comment of comments) {
        process.stdout.write("\n");
        const author = comment.authorName || "Unknown";
        process.stdout.write(`  ${author}`);
        if (comment.createdAt) {
          process.stdout.write(
            ` (${new Date(comment.createdAt).toISOString()})`,
          );
        }
        process.stdout.write(":\n");
        if (comment.text) {
          process.stdout.write(`    ${comment.text}\n`);
        }
        if (comment.reactionCount > 0) {
          process.stdout.write(
            `    [${String(comment.reactionCount)} reaction${comment.reactionCount === 1 ? "" : "s"}]\n`,
          );
        }
      }
    }
  }
}
