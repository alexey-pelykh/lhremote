// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignRepository,
  DEFAULT_CDP_PORT,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpSuccess } from "../helpers.js";

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
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(DEFAULT_CDP_PORT)
        .describe("CDP port"),
      cdpHost: z
        .string()
        .optional()
        .describe("CDP host (default: 127.0.0.1)"),
      allowRemote: z
        .boolean()
        .optional()
        .describe("Allow non-loopback CDP connections"),
    },
    async ({ includeArchived, cdpPort, cdpHost, allowRemote }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort, { ...(cdpHost !== undefined && { host: cdpHost }), ...(allowRemote !== undefined && { allowRemote }) });
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
