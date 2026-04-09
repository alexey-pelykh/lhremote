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
    'Dismiss a post from the LinkedIn feed by clicking "Not interested" in its three-dot menu. The post must be visible in the home feed.',
    {
      postUrl: z
        .string()
        .describe(
          "LinkedIn post URL (e.g. https://www.linkedin.com/feed/update/urn:li:activity:1234567890/)",
        ),
      ...cdpConnectionSchema,
    },
    async ({ postUrl, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await dismissFeedPost({
          postUrl,
          cdpPort,
          cdpHost,
          allowRemote,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to dismiss feed post");
      }
    },
  );
}
