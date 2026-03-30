// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  errorMessage,
  getPostStats,
  type GetPostStatsOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#get-post-stats | get-post-stats} CLI command. */
export async function handleGetPostStats(
  postUrl: string,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: GetPostStatsOutput;
  try {
    result = await getPostStats({
      postUrl,
      cdpPort: options.cdpPort,
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
    const { stats } = result;
    process.stdout.write(`Post: ${stats.postUrn}\n\n`);
    process.stdout.write(`  Reactions: ${String(stats.reactionCount)}\n`);

    if (stats.reactionsByType.length > 0) {
      for (const r of stats.reactionsByType) {
        process.stdout.write(`    ${r.type}: ${String(r.count)}\n`);
      }
    }

    process.stdout.write(`  Comments:  ${String(stats.commentCount)}\n`);
    process.stdout.write(`  Shares:    ${String(stats.shareCount)}\n`);
  }
}
