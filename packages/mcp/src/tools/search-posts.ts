// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchPosts } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#search-posts | search-posts} MCP tool. */
export function registerSearchPosts(server: McpServer): void {
  server.tool(
    "search-posts",
    "Search LinkedIn for posts by keyword or hashtag. Returns structured post data with author info and engagement counts. Supports pagination.",
    {
      query: z
        .string()
        .describe(
          'Search query — keywords (e.g. "AI agents") or hashtag (e.g. "#AIAgents")',
        ),
      start: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .default(0)
        .describe("Pagination offset (default: 0)"),
      count: z
        .number()
        .int()
        .positive()
        .optional()
        .default(10)
        .describe("Number of results per page (default: 10)"),
      ...cdpConnectionSchema,
    },
    async ({ query, start, count, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await searchPosts({
          query,
          start,
          count,
          cdpPort,
          cdpHost,
          allowRemote,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to search posts");
      }
    },
  );
}
