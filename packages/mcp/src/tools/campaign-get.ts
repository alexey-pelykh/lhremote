// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

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

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-get | campaign-get} MCP tool. */
export function registerCampaignGet(server: McpServer): void {
  server.tool(
    "campaign-get",
    "Get detailed information about a campaign including its actions and configuration",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, cdpPort, cdpHost, allowRemote }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort, buildCdpOptions({ cdpHost, allowRemote }));
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withDatabase(accountId, ({ db }) => {
          const campaignRepo = new CampaignRepository(db);
          const campaign = campaignRepo.getCampaign(campaignId);
          const actions = campaignRepo.getCampaignActions(campaignId);

          return mcpSuccess(JSON.stringify({ ...campaign, actions }, null, 2));
        });
      } catch (error) {
        return mcpCatchAll(error, "Failed to get campaign");
      }
    },
  );
}
