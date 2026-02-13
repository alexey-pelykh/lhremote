// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  type MessageStats,
  DEFAULT_CDP_PORT,
  errorMessage,
  InstanceNotRunningError,
  MessageRepository,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#profiles--messaging | scrape-messaging-history} CLI command. */
export async function handleScrapeMessagingHistory(options: {
  cdpPort?: number;
  cdpHost?: string;
  allowRemote?: boolean;
  json?: boolean;
}): Promise<void> {
  const cdpPort = options.cdpPort ?? DEFAULT_CDP_PORT;

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
      process.stderr.write("Scraping messaging history from LinkedIn...\n");

      // Execute the scrape action (may take several minutes)
      await instance.executeAction("ScrapeMessagingHistory");

      process.stderr.write("Done.\n");

      // Query stats from the database
      const repo = new MessageRepository(db);
      const stats = repo.getMessageStats();

      if (options.json) {
        process.stdout.write(
          JSON.stringify(
            { success: true, actionType: "ScrapeMessagingHistory", stats },
            null,
            2,
          ) + "\n",
        );
      } else {
        printStats(stats);
      }
    }, { instanceTimeout: 300_000 });
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

function printStats(stats: MessageStats): void {
  process.stdout.write(`\nDatabase now contains:\n`);
  process.stdout.write(
    `  ${String(stats.totalChats)} conversations\n`,
  );
  process.stdout.write(
    `  ${String(stats.totalMessages)} messages\n`,
  );

  if (stats.earliestMessage && stats.latestMessage) {
    const earliest = stats.earliestMessage.slice(0, 10);
    const latest = stats.latestMessage.slice(0, 10);
    process.stdout.write(`  Date range: ${earliest} — ${latest}\n`);
  }

  process.stdout.write(
    `\nUse \`lhremote query-messages\` to browse conversations.\n`,
  );
}
