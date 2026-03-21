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
    start?: number;
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
      start: options.start,
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
    const { posts, paging } = result;
    process.stdout.write(
      `Search: "${result.query}" (${String(paging.total)} results)\n\n`,
    );

    if (posts.length === 0) {
      process.stdout.write("No posts found.\n");
      return;
    }

    for (const post of posts) {
      const author = [post.authorFirstName, post.authorLastName]
        .filter(Boolean)
        .join(" ") || "Unknown";
      process.stdout.write(`  ${post.postUrn}\n`);
      process.stdout.write(`    Author:    ${author}`);
      if (post.authorPublicId) {
        process.stdout.write(` (${post.authorPublicId})`);
      }
      process.stdout.write("\n");
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
        `    Reactions: ${String(post.reactionCount)}  Comments: ${String(post.commentCount)}\n`,
      );
      process.stdout.write("\n");
    }

    if (paging.start + posts.length < paging.total) {
      process.stdout.write(
        `Showing ${String(paging.start + 1)}-${String(paging.start + posts.length)} of ${String(paging.total)}. ` +
          `Use --start ${String(paging.start + posts.length)} for next page.\n`,
      );
    }
  }
}
