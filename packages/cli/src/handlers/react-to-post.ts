// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  DEFAULT_CDP_PORT,
  errorMessage,
  reactToPost,
  type ReactToPostOutput,
  type ReactionType,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#react-to-post | react-to-post} CLI command. */
export async function handleReactToPost(
  postUrl: string,
  options: {
    type?: string;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: ReactToPostOutput;
  try {
    result = await reactToPost({
      postUrl,
      reactionType: (options.type as ReactionType | undefined),
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
    process.stdout.write(
      `Reacted to post with "${result.reactionType}"\n` +
        `  Post: ${result.postUrl}\n`,
    );
  }
}
