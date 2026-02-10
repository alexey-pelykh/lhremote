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

export function registerScrapeMessagingHistory(server: McpServer): void {
  server.tool(
    "scrape-messaging-history",
    "Trigger LinkedHelper to scrape all messaging history from LinkedIn into the local database, then return aggregate stats. This is a long-running operation that may take several minutes.",
    {
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ cdpPort }) => {
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

      // Connect to instance, execute action, then query stats
      // Use a 5-minute timeout — scraping messaging history is long-running
      const instance = new InstanceService(instancePort, { timeout: 300_000 });
      let db: DatabaseClient | null = null;

      try {
        await instance.connect();

        // Execute the scrape action (may take several minutes)
        await instance.executeAction("ScrapeMessagingHistory");

        // Query stats from the database
        const dbPath = discoverDatabase(accountId);
        db = new DatabaseClient(dbPath);
        const repo = new MessageRepository(db);
        const stats = repo.getMessageStats();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  actionType: "ScrapeMessagingHistory",
                  stats,
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
              text: `Failed to scrape messaging history: ${message}`,
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
