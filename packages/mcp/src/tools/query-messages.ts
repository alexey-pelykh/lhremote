// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ChatNotFoundError,
  queryMessages,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

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
      ...cdpConnectionSchema,
    },
    async ({ personId, chatId, search, limit, offset, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await queryMessages({ personId, chatId, search, limit, offset, cdpPort, cdpHost, allowRemote });
        if (result.kind === "thread") return mcpSuccess(JSON.stringify(result.thread, null, 2));
        if (result.kind === "search") return mcpSuccess(JSON.stringify({ messages: result.messages, total: result.total }, null, 2));
        return mcpSuccess(JSON.stringify({ conversations: result.conversations, total: result.total }, null, 2));
      } catch (error) {
        if (error instanceof ChatNotFoundError) {
          return mcpError("Chat not found.");
        }
        return mcpCatchAll(error, "Failed to query messages");
      }
    },
  );
}
