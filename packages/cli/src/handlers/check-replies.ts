import {
  type Account,
  type ConversationMessages,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  errorMessage,
  InstanceService,
  LauncherService,
  MessageRepository,
} from "@lhremote/core";

export async function handleCheckReplies(options: {
  since?: string;
  cdpPort?: number;
  json?: boolean;
}): Promise<void> {
  const cdpPort = options.cdpPort ?? 9222;
  const cutoff =
    options.since ??
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

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

  // Connect to instance, execute action, then query new messages
  const instance = new InstanceService(instancePort, { timeout: 120_000 });
  let db: DatabaseClient | null = null;

  try {
    await instance.connect();

    process.stderr.write("Checking for new replies...\n");

    await instance.executeAction("CheckForReplies");

    process.stderr.write("Done.\n");

    // Query messages from the database
    const dbPath = discoverDatabase(accountId);
    db = new DatabaseClient(dbPath);
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
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    instance.disconnect();
    db?.close();
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
