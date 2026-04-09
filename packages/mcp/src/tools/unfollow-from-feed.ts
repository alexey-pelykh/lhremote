// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { unfollowFromFeed } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#unfollow-from-feed | unfollow-from-feed} MCP tool. */
export function registerUnfollowFromFeed(server: McpServer): void {
  server.tool(
    "unfollow-from-feed",
    "Unfollow the author of a LinkedIn post via its feed three-dot menu. Navigates to the post and clicks the 'Unfollow {Name}' menu item.",
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
        const result = await unfollowFromFeed({
          postUrl,
          cdpPort,
          cdpHost,
          allowRemote,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to unfollow from feed");
      }
    },
  );
}
