// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  errorMessage,
  dismissFeedPost,
  type DismissFeedPostOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#dismiss-feed-post | dismiss-feed-post} CLI command. */
export async function handleDismissFeedPost(
  feedIndex: number,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    dryRun?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: DismissFeedPostOutput;
  try {
    result = await dismissFeedPost({
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
      `[dry-run] Would dismiss post from feed\n  Feed index: ${result.feedIndex}\n`,
    );
  } else {
    process.stdout.write(
      `Dismissed post from feed\n  Feed index: ${result.feedIndex}\n`,
    );
  }
}
