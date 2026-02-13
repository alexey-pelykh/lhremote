// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  type ConversationMessages,
  DEFAULT_CDP_PORT,
  errorMessage,
  InstanceNotRunningError,
  MessageRepository,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#profiles--messaging | check-replies} CLI command. */
export async function handleCheckReplies(options: {
  since?: string;
  cdpPort?: number;
  cdpHost?: string;
  allowRemote?: boolean;
  json?: boolean;
}): Promise<void> {
  const cdpPort = options.cdpPort ?? DEFAULT_CDP_PORT;
  const cutoff =
    options.since ??
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let accountId: number;
  try {
    accountId = await resolveAccount(cdpPort, {
      ...(options.cdpHost !== undefined && { host: options.cdpHost }),
      ...(options.allowRemote !== undefined && { allowRemote: options.allowRemote }),
    });
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
      process.stderr.write("Checking for new replies...\n");

      await instance.executeAction("CheckForReplies");

      process.stderr.write("Done.\n");

      // Query messages from the database
      const repo = new MessageRepository(db);
      const conversations = repo.getMessagesSince(cutoff);

      const totalNew = conversations.reduce(
        (sum, c) => sum + c.messages.length,
        0,
      );

      if (options.json) {
        process.stdout.write(
          JSON.stringify(
            {
              newMessages: conversations,
              totalNew,
              checkedAt: new Date().toISOString(),
            },
            null,
            2,
          ) + "\n",
        );
      } else {
        printReplies(conversations, totalNew);
      }
    }, { instanceTimeout: 120_000 });
  } catch (error) {
    if (error instanceof InstanceNotRunningError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
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
