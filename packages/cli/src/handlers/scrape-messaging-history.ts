// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  type MessageStats,
  DEFAULT_CDP_PORT,
  errorMessage,
  InstanceNotRunningError,
  scrapeMessagingHistory,
  type ScrapeMessagingHistoryOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#profiles--messaging | scrape-messaging-history} CLI command. */
export async function handleScrapeMessagingHistory(options: {
  cdpPort?: number;
  cdpHost?: string;
  allowRemote?: boolean;
  json?: boolean;
}): Promise<void> {
  process.stderr.write("Scraping messaging history from LinkedIn...\n");

  let result: ScrapeMessagingHistoryOutput;
  try {
    result = await scrapeMessagingHistory({
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
    printStats(result.stats);
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
