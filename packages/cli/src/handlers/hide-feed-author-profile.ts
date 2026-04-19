// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  errorMessage,
  hideFeedAuthorProfile,
  type HideFeedAuthorProfileOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#hide-feed-author-profile | hide-feed-author-profile} CLI command. */
export async function handleHideFeedAuthorProfile(
  profileUrl: string,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    dryRun?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: HideFeedAuthorProfileOutput;
  try {
    result = await hideFeedAuthorProfile({
      profileUrl,
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
    return;
  }

  if (!result.success) {
    if (result.reason === "already_muted") {
      process.stdout.write(
        `Profile "${result.publicId}" is already muted (no action taken)\n`,
      );
    } else {
      process.stdout.write(
        `Mute is not available for "${result.publicId}" ` +
          "(non-1st-degree connection, blocked, or private profile)\n",
      );
      process.exitCode = 1;
    }
    return;
  }

  if (result.dryRun) {
    process.stdout.write(
      `[dry-run] Would mute posts by "${result.hiddenName}" via their profile page\n` +
        `  Profile: ${result.profileUrl}\n`,
    );
  } else {
    process.stdout.write(
      `Muted posts by "${result.hiddenName}" via their profile page\n` +
        `  Profile: ${result.profileUrl}\n`,
    );
  }
}
