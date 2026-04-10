// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dismissFeedPost } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#dismiss-feed-post | dismiss-feed-post} MCP tool. */
export function registerDismissFeedPost(server: McpServer): void {
  server.tool(
    "dismiss-feed-post",
    'Dismiss a post from the LinkedIn feed by clicking "Not interested" in its three-dot menu. Operates on the home feed by position index (pair with get-feed to identify posts).',
    {
      feedIndex: z.number().int().min(0).describe("Zero-based index of the post in the visible LinkedIn feed (pair with get-feed to identify posts)"),
      dryRun: z.boolean().optional().default(false).describe("When true, locate the menu item but do not click it"),
      ...cdpConnectionSchema,
    },
    async ({ feedIndex, dryRun, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await dismissFeedPost({
          feedIndex,
          cdpPort,
          cdpHost,
          allowRemote,
          dryRun,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to dismiss feed post");
      }
    },
  );
}
