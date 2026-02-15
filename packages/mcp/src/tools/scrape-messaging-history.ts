// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  scrapeMessagingHistory,
} from "@lhremote/core";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#scrape-messaging-history | scrape-messaging-history} MCP tool. */
export function registerScrapeMessagingHistory(server: McpServer): void {
  server.tool(
    "scrape-messaging-history",
    "Trigger LinkedHelper to scrape all messaging history from LinkedIn into the local database, then return aggregate stats. This is a long-running operation that may take several minutes.",
    {
      ...cdpConnectionSchema,
    },
    async ({ cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await scrapeMessagingHistory({ cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to scrape messaging history");
      }
    },
  );
}
