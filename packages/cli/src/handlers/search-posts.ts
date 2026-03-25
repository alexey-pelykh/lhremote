// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  DEFAULT_CDP_PORT,
  errorMessage,
  searchPosts,
  type SearchPostsOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#search-posts | search-posts} CLI command. */
export async function handleSearchPosts(
  query: string,
  options: {
    cursor?: string;
    count?: number;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: SearchPostsOutput;
  try {
    result = await searchPosts({
      query,
      cursor: options.cursor,
      count: options.count,
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
    process.stdout.write(`Search: "${result.query}"\n\n`);

    const { posts } = result;

    if (posts.length === 0) {
      process.stdout.write("No posts found.\n");
      return;
    }

    for (const post of posts) {
      const author = post.authorName ?? "Unknown";
      process.stdout.write(`  ${post.urn}\n`);
      process.stdout.write(`    Author:    ${author}\n`);
      if (post.authorHeadline) {
        process.stdout.write(`    Headline:  ${post.authorHeadline}\n`);
      }
      if (post.text) {
        const preview =
          post.text.length > 120
            ? post.text.substring(0, 120) + "..."
            : post.text;
        process.stdout.write(`    Text:      ${preview}\n`);
      }
      process.stdout.write(
        `    Reactions: ${String(post.reactionCount)}  Comments: ${String(post.commentCount)}  Reposts: ${String(post.shareCount)}\n`,
      );
      process.stdout.write("\n");
    }

    if (result.nextCursor) {
      process.stdout.write(
        `More results available. Use --cursor ${result.nextCursor} for next page.\n`,
      );
    }
  }
}
