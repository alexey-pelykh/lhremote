import {
  type Account,
  type MessageStats,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  errorMessage,
  InstanceService,
  LauncherService,
  MessageRepository,
} from "@lhremote/core";

export async function handleScrapeMessagingHistory(options: {
  cdpPort?: number;
  json?: boolean;
}): Promise<void> {
  const cdpPort = options.cdpPort ?? 9222;

  // Connect to launcher to find the running account
  const launcher = new LauncherService(cdpPort);

  let accountId: number;
  try {
    await launcher.connect();
    const accounts = await launcher.listAccounts();
    if (accounts.length === 0) {
      process.stderr.write("No accounts found.\n");
      process.exitCode = 1;
      return;
    }
    if (accounts.length > 1) {
      process.stderr.write(
        "Multiple accounts found. Cannot determine which instance to use.\n",
      );
      process.exitCode = 1;
      return;
    }
    accountId = (accounts[0] as Account).id;
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  } finally {
    launcher.disconnect();
  }

  // Discover instance CDP port
  const instancePort = await discoverInstancePort(cdpPort);
  if (instancePort === null) {
    process.stderr.write(
      "No LinkedHelper instance is running. Use start-instance first.\n",
    );
    process.exitCode = 1;
    return;
  }

  // Connect to instance, execute action, then query stats
  // Use a 5-minute timeout — scraping messaging history is long-running
  const instance = new InstanceService(instancePort, { timeout: 300_000 });
  let db: DatabaseClient | null = null;

  try {
    await instance.connect();

    process.stderr.write("Scraping messaging history from LinkedIn...\n");

    // Execute the scrape action (may take several minutes)
    await instance.executeAction("ScrapeMessagingHistory");

    process.stderr.write("Done.\n");

    // Query stats from the database
    const dbPath = discoverDatabase(accountId);
    db = new DatabaseClient(dbPath);
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
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    instance.disconnect();
    db?.close();
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
