import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  MessageRepository,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#scrape-messaging-history | scrape-messaging-history} MCP tool. */
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
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort);
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
          // Execute the scrape action (may take several minutes)
          await instance.executeAction("ScrapeMessagingHistory");

          // Query stats from the database
          const repo = new MessageRepository(db);
          const stats = repo.getMessageStats();

          return mcpSuccess(
            JSON.stringify(
              {
                success: true,
                actionType: "ScrapeMessagingHistory",
                stats,
              },
              null,
              2,
            ),
          );
        }, { instanceTimeout: 300_000 });
      } catch (error) {
        return mcpCatchAll(error, "Failed to scrape messaging history");
      }
    },
  );
}
