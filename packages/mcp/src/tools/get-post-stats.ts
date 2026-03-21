// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPostStats } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#get-post-stats | get-post-stats} MCP tool. */
export function registerGetPostStats(server: McpServer): void {
  server.tool(
    "get-post-stats",
    "Get engagement statistics for a LinkedIn post: reaction count (broken down by type), comment count, and share count.",
    {
      postUrl: z
        .string()
        .describe(
          "LinkedIn post URL or URN (e.g. https://www.linkedin.com/feed/update/urn:li:activity:1234567890/ or urn:li:activity:1234567890)",
        ),
      ...cdpConnectionSchema,
    },
    async ({ postUrl, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await getPostStats({ postUrl, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to get post stats");
      }
    },
  );
}
