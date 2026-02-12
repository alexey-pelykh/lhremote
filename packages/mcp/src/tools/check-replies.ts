import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  MessageRepository,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#check-replies | check-replies} MCP tool. */
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

      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort);
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
          // Execute the CheckForReplies action
          await instance.executeAction("CheckForReplies");

          // Query messages from the database
          const repo = new MessageRepository(db);
          const conversations = repo.getMessagesSince(cutoff);

          const totalNew = conversations.reduce(
            (sum, c) => sum + c.messages.length,
            0,
          );

          return mcpSuccess(
            JSON.stringify(
              {
                newMessages: conversations,
                totalNew,
                checkedAt: new Date().toISOString(),
              },
              null,
              2,
            ),
          );
        }, { instanceTimeout: 120_000 });
      } catch (error) {
        return mcpCatchAll(error, "Failed to check replies");
      }
    },
  );
}
