import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  errorMessage,
  InstanceNotRunningError,
  InstanceService,
  LauncherService,
  LinkedHelperNotRunningError,
  MessageRepository,
} from "@lhremote/core";
import { z } from "zod";

export function registerCheckReplies(server: McpServer): void {
  server.tool(
    "check-replies",
    "Trigger LinkedHelper to check for new message replies on LinkedIn, then return any new messages found. If `since` is omitted, returns messages from the last 24 hours.",
    {
      since: z
        .string()
        .optional()
        .describe(
          "ISO timestamp; only return messages after this time. If omitted, returns messages from the last 24 hours",
        ),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ since, cdpPort }) => {
      const cutoff =
        since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Connect to launcher to find running instance
      const launcher = new LauncherService(cdpPort);

      try {
        await launcher.connect();
      } catch (error) {
        if (error instanceof LinkedHelperNotRunningError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "LinkedHelper is not running. Use launch-app first.",
              },
            ],
          };
        }
        const message = errorMessage(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to connect to LinkedHelper: ${message}`,
            },
          ],
        };
      }

      let accountId: number;
      try {
        const accounts = await launcher.listAccounts();
        if (accounts.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "No accounts found.",
              },
            ],
          };
        }
        if (accounts.length > 1) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "Multiple accounts found. Cannot determine which instance to use.",
              },
            ],
          };
        }
        accountId = (accounts[0] as Account).id;
      } catch (error) {
        const message = errorMessage(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to list accounts: ${message}`,
            },
          ],
        };
      } finally {
        launcher.disconnect();
      }

      // Discover instance CDP port
      const instancePort = await discoverInstancePort(cdpPort);
      if (instancePort === null) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "No LinkedHelper instance is running. Use start-instance first.",
            },
          ],
        };
      }

      // Connect to instance, execute action, then query new messages
      const instance = new InstanceService(instancePort, { timeout: 120_000 });
      let db: DatabaseClient | null = null;

      try {
        await instance.connect();

        // Execute the CheckForReplies action
        await instance.executeAction("CheckForReplies");

        // Query messages from the database
        const dbPath = discoverDatabase(accountId);
        db = new DatabaseClient(dbPath);
        const repo = new MessageRepository(db);
        const conversations = repo.getMessagesSince(cutoff);

        const totalNew = conversations.reduce(
          (sum, c) => sum + c.messages.length,
          0,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  newMessages: conversations,
                  totalNew,
                  checkedAt: new Date().toISOString(),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        if (error instanceof InstanceNotRunningError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "No LinkedHelper instance is running. Use start-instance first.",
              },
            ],
          };
        }
        const message = errorMessage(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to check replies: ${message}`,
            },
          ],
        };
      } finally {
        instance.disconnect();
        db?.close();
      }
    },
  );
}
