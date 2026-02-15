// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  type ConversationMessages,
  DEFAULT_CDP_PORT,
  errorMessage,
  InstanceNotRunningError,
  checkReplies,
  type CheckRepliesOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#profiles--messaging | check-replies} CLI command. */
export async function handleCheckReplies(options: {
  since?: string;
  cdpPort?: number;
  cdpHost?: string;
  allowRemote?: boolean;
  json?: boolean;
}): Promise<void> {
  process.stderr.write("Checking for new replies...\n");

  let result: CheckRepliesOutput;
  try {
    result = await checkReplies({
      since: options.since,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof InstanceNotRunningError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stderr.write("Done.\n");

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printReplies(result.newMessages, result.totalNew);
  }
}

function printReplies(
  conversations: ConversationMessages[],
  totalNew: number,
): void {
  if (totalNew === 0) {
    process.stdout.write("No new messages found.\n");
    return;
  }

  process.stdout.write(
    `\n${String(totalNew)} new message${totalNew === 1 ? "" : "s"} found:\n`,
  );

  for (const conv of conversations) {
    process.stdout.write(
      `\n${conv.personName} (person #${String(conv.personId)}, chat #${String(conv.chatId)}):\n`,
    );
    for (const msg of conv.messages) {
      const ts = msg.sendAt.replace("T", " ").slice(0, 16);
      process.stdout.write(`  [${ts}] ${msg.text}\n`);
    }
  }
}
