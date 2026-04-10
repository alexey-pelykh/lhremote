// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  errorMessage,
  unfollowFromFeed,
  type UnfollowFromFeedOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#unfollow-from-feed | unfollow-from-feed} CLI command. */
export async function handleUnfollowFromFeed(
  feedIndex: number,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    dryRun?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: UnfollowFromFeedOutput;
  try {
    result = await unfollowFromFeed({
      feedIndex,
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
    process.stdout.write(
      `[dry-run] Would unfollow "${result.unfollowedName}" from feed\n` +
        `  Feed index: ${result.feedIndex}\n`,
    );
  } else {
    process.stdout.write(
      `Unfollowed "${result.unfollowedName}" from feed\n` +
        `  Feed index: ${result.feedIndex}\n`,
    );
  }
}
