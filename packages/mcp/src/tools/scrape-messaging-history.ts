// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  MessageRepository,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";
import { buildCdpOptions, cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#scrape-messaging-history | scrape-messaging-history} MCP tool. */
export function registerScrapeMessagingHistory(server: McpServer): void {
  server.tool(
    "scrape-messaging-history",
    "Trigger LinkedHelper to scrape all messaging history from LinkedIn into the local database, then return aggregate stats. This is a long-running operation that may take several minutes.",
    {
      ...cdpConnectionSchema,
    },
    async ({ cdpPort, cdpHost, allowRemote }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort, buildCdpOptions({ cdpHost, allowRemote }));
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
          // Execute the scrape action (may take several minutes)
          await instance.executeAction("ScrapeMessagingHistory");

          // Query stats from the database
          const repo = new MessageRepository(db);
          const stats = repo.getMessageStats();

          return mcpSuccess(
            JSON.stringify(
              {
                success: true,
                actionType: "ScrapeMessagingHistory",
                stats,
              },
              null,
              2,
            ),
          );
        }, { instanceTimeout: 300_000 });
      } catch (error) {
        return mcpCatchAll(error, "Failed to scrape messaging history");
      }
    },
  );
}
