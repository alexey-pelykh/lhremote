// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  errorMessage,
  hideFeedAuthor,
  type HideFeedAuthorOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#hide-feed-author | hide-feed-author} CLI command. */
export async function handleHideFeedAuthor(
  feedIndex: number,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    dryRun?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: HideFeedAuthorOutput;
  try {
    result = await hideFeedAuthor({
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
      `[dry-run] Would hide posts by "${result.hiddenName}"\n` +
        `  Feed index: ${result.feedIndex}\n`,
    );
  } else {
    process.stdout.write(
      `Hidden posts by "${result.hiddenName}"\n` +
        `  Feed index: ${result.feedIndex}\n`,
    );
  }
}
