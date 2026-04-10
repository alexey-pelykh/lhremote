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
    "Click 'Hide posts by {Name}' in a feed post's three-dot menu. Operates on the home feed by position index (pair with get-feed to identify posts). The hidden person may differ from the original author (e.g. reposter).",
    {
      feedIndex: z.number().int().min(0).describe("Zero-based index of the post in the visible LinkedIn feed (pair with get-feed to identify posts)"),
      dryRun: z.boolean().optional().default(false).describe("When true, locate the menu item but do not click it"),
      ...cdpConnectionSchema,
    },
    async ({ feedIndex, dryRun, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await hideFeedAuthor({
          feedIndex,
          cdpPort,
          cdpHost,
          allowRemote,
          dryRun,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to hide feed author");
      }
    },
  );
}
