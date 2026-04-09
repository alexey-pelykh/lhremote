// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { hideFeedAuthor } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#hide-feed-author | hide-feed-author} MCP tool. */
export function registerHideFeedAuthor(server: McpServer): void {
  server.tool(
    "hide-feed-author",
    "Click 'Hide posts by {Name}' in a feed post's three-dot menu. The hidden person may differ from the original author (e.g. reposter).",
    {
      postUrl: z
        .string()
        .describe(
          "LinkedIn post URL identifying the feed post whose 'Hide posts by' action to invoke",
        ),
      ...cdpConnectionSchema,
    },
    async ({ postUrl, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await hideFeedAuthor({
          postUrl,
          cdpPort,
          cdpHost,
          allowRemote,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to hide feed author");
      }
    },
  );
}
