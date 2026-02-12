import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ChatNotFoundError,
  MessageRepository,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#query-messages | query-messages} MCP tool. */
export function registerQueryMessages(server: McpServer): void {
  server.tool(
    "query-messages",
    "Query messaging history from the local LinkedHelper database. List conversations, read threads, or search messages.",
    {
      personId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Filter conversations by person ID"),
      chatId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Get a specific conversation thread"),
      search: z
        .string()
        .optional()
        .describe("Search message text (LIKE match)"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max results (default: 20)"),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Pagination offset (default: 0)"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ personId, chatId, search, limit, offset, cdpPort }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort);
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      const effectiveLimit = limit ?? 20;
      const effectiveOffset = offset ?? 0;

      try {
        return await withDatabase(accountId, ({ db }) => {
          const repo = new MessageRepository(db);

          if (chatId != null) {
            const thread = repo.getThread(chatId, {
              limit: effectiveLimit,
            });
            return mcpSuccess(JSON.stringify(thread, null, 2));
          }

          if (search != null) {
            const messages = repo.searchMessages(search, {
              limit: effectiveLimit,
            });
            return mcpSuccess(
              JSON.stringify({ messages, total: messages.length }, null, 2),
            );
          }

          const conversations = repo.listChats({
            ...(personId != null && { personId }),
            limit: effectiveLimit,
            offset: effectiveOffset,
          });
          return mcpSuccess(
            JSON.stringify(
              { conversations, total: conversations.length },
              null,
              2,
            ),
          );
        });
      } catch (error) {
        if (error instanceof ChatNotFoundError) {
          return mcpError("Chat not found.");
        }
        return mcpCatchAll(error, "Failed to query messages");
      }
    },
  );
}
