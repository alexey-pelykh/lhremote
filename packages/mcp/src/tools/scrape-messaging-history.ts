// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  scrapeMessagingHistory,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#scrape-messaging-history | scrape-messaging-history} MCP tool. */
export function registerScrapeMessagingHistory(server: McpServer): void {
  server.tool(
    "scrape-messaging-history",
    "Trigger LinkedHelper to scrape messaging history from LinkedIn for the specified people into the local database, then return aggregate stats. This is a long-running operation that may take several minutes.",
    {
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs whose messaging history should be scraped"),
      ...cdpConnectionSchema,
    },
    async ({ personIds, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await scrapeMessagingHistory({ personIds, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to scrape messaging history");
      }
    },
  );
}
