// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignRepository,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import {
  buildCdpOptions,
  cdpConnectionSchema,
  mcpCatchAll,
  mcpSuccess,
} from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-list | campaign-list} MCP tool. */
export function registerCampaignList(server: McpServer): void {
  server.tool(
    "campaign-list",
    "List existing LinkedHelper campaigns with summary statistics",
    {
      includeArchived: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include archived campaigns"),
      ...cdpConnectionSchema,
    },
    async ({ includeArchived, cdpPort, cdpHost, allowRemote }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort, buildCdpOptions({ cdpHost, allowRemote }));
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withDatabase(accountId, ({ db }) => {
          const campaignRepo = new CampaignRepository(db);
          const campaigns = campaignRepo.listCampaigns({ includeArchived });

          return mcpSuccess(
            JSON.stringify(
              { campaigns, total: campaigns.length },
              null,
              2,
            ),
          );
        });
      } catch (error) {
        return mcpCatchAll(error, "Failed to list campaigns");
      }
    },
  );
}
