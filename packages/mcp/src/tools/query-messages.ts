import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ChatNotFoundError,
  DatabaseClient,
  discoverAllDatabases,
  errorMessage,
  MessageRepository,
} from "@lhremote/core";
import { z } from "zod";

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
    },
    async ({ personId, chatId, search, limit, offset }) => {
      const databases = discoverAllDatabases();
      if (databases.size === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "No LinkedHelper databases found.",
            },
          ],
        };
      }

      const effectiveLimit = limit ?? 20;
      const effectiveOffset = offset ?? 0;

      for (const [, dbPath] of databases) {
        const db = new DatabaseClient(dbPath);
        try {
          const repo = new MessageRepository(db);

          if (chatId != null) {
            const thread = repo.getThread(chatId, {
              limit: effectiveLimit,
            });
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(thread, null, 2),
                },
              ],
            };
          }

          if (search != null) {
            const messages = repo.searchMessages(search, {
              limit: effectiveLimit,
            });
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ messages, total: messages.length }, null, 2),
                },
              ],
            };
          }

          const conversations = repo.listChats({
            ...(personId != null && { personId }),
            limit: effectiveLimit,
            offset: effectiveOffset,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { conversations, total: conversations.length },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          if (error instanceof ChatNotFoundError) {
            continue;
          }
          const message = errorMessage(error);
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Failed to query messages: ${message}`,
              },
            ],
          };
        } finally {
          db.close();
        }
      }

      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Chat not found.",
          },
        ],
      };
    },
  );
}
