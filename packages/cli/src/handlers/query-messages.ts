import {
  type Chat,
  type ConversationThread,
  type Message,
  ChatNotFoundError,
  DatabaseClient,
  discoverAllDatabases,
  errorMessage,
  MessageRepository,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#profiles--messaging | query-messages} CLI command. */
export async function handleQueryMessages(options: {
  personId?: number;
  chatId?: number;
  search?: string;
  limit?: number;
  offset?: number;
  json?: boolean;
}): Promise<void> {
  const databases = discoverAllDatabases();
  if (databases.size === 0) {
    process.stderr.write("No LinkedHelper databases found.\n");
    process.exitCode = 1;
    return;
  }

  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  for (const [, dbPath] of databases) {
    const db = new DatabaseClient(dbPath);
    try {
      const repo = new MessageRepository(db);

      if (options.chatId != null) {
        const thread = repo.getThread(options.chatId, { limit });

        if (options.json) {
          process.stdout.write(JSON.stringify(thread, null, 2) + "\n");
        } else {
          printThread(thread);
        }
        return;
      }

      if (options.search != null) {
        const messages = repo.searchMessages(options.search, { limit });

        if (options.json) {
          process.stdout.write(
            JSON.stringify({ messages, total: messages.length }, null, 2) + "\n",
          );
        } else {
          printSearchResults(messages, options.search);
        }
        return;
      }

      const conversations = repo.listChats({
        ...(options.personId != null && { personId: options.personId }),
        limit,
        offset,
      });

      if (options.json) {
        process.stdout.write(
          JSON.stringify(
            { conversations, total: conversations.length },
            null,
            2,
          ) + "\n",
        );
      } else {
        printConversationList(conversations);
      }
      return;
    } catch (error) {
      if (error instanceof ChatNotFoundError) {
        continue;
      }
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    } finally {
      db.close();
    }
  }

  process.stderr.write("Chat not found.\n");
  process.exitCode = 1;
}

function printConversationList(conversations: Chat[]): void {
  if (conversations.length === 0) {
    process.stdout.write("No conversations found.\n");
    return;
  }

  process.stdout.write(`Conversations (${String(conversations.length)}):\n`);

  for (const chat of conversations) {
    const names = chat.participants
      .map((p) => [p.firstName, p.lastName].filter(Boolean).join(" "))
      .join(", ");
    process.stdout.write(
      `\n#${String(chat.id)} with ${names} (${String(chat.messageCount)} messages)\n`,
    );
    if (chat.lastMessage) {
      const date = chat.lastMessage.sendAt.slice(0, 10);
      process.stdout.write(
        `  Last: "${chat.lastMessage.text}" — ${date}\n`,
      );
    }
  }
}

function printThread(thread: ConversationThread): void {
  const names = thread.chat.participants
    .map((p) => [p.firstName, p.lastName].filter(Boolean).join(" "))
    .join(", ");
  process.stdout.write(
    `Conversation #${String(thread.chat.id)} with ${names} (${String(thread.chat.messageCount)} messages):\n`,
  );

  for (const msg of thread.messages) {
    const senderName = [msg.senderFirstName, msg.senderLastName]
      .filter(Boolean)
      .join(" ");
    const ts = msg.sendAt.replace("T", " ").slice(0, 16);
    process.stdout.write(`\n[${ts}] ${senderName}:\n`);
    process.stdout.write(`  ${msg.text}\n`);
  }
}

function printSearchResults(messages: Message[], query: string): void {
  if (messages.length === 0) {
    process.stdout.write(`No messages matching "${query}".\n`);
    return;
  }

  process.stdout.write(
    `Messages matching "${query}" (${String(messages.length)}):\n`,
  );

  for (const msg of messages) {
    const senderName = [msg.senderFirstName, msg.senderLastName]
      .filter(Boolean)
      .join(" ");
    const ts = msg.sendAt.replace("T", " ").slice(0, 16);
    process.stdout.write(`\n[${ts}] ${senderName}:\n`);
    process.stdout.write(`  ${msg.text}\n`);
  }
}
