// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getFeed } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#get-feed | get-feed} MCP tool. */
export function registerGetFeed(server: McpServer): void {
  server.tool(
    "get-feed",
    "Read the LinkedIn home feed. Returns structured post data (URN, URL, author, text, media type, engagement counts, timestamp) with cursor-based pagination.",
    {
      count: z
        .number()
        .int()
        .positive()
        .optional()
        .default(10)
        .describe("Number of posts per page (default: 10)"),
      cursor: z
        .string()
        .optional()
        .describe(
          "Cursor token from a previous get-feed call for the next page",
        ),
      ...cdpConnectionSchema,
    },
    async ({ count, cursor, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await getFeed({
          count,
          cursor,
          cdpPort,
          cdpHost,
          allowRemote,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to get feed");
      }
    },
  );
}
