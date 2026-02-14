// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignRepository,
  resolveAccount,
  serializeCampaignJson,
  serializeCampaignYaml,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import {
  buildCdpOptions,
  cdpConnectionSchema,
  mcpCatchAll,
  mcpSuccess,
} from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-export | campaign-export} MCP tool. */
export function registerCampaignExport(server: McpServer): void {
  server.tool(
    "campaign-export",
    "Export a campaign configuration as YAML or JSON for backup or reuse",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      format: z
        .enum(["yaml", "json"])
        .optional()
        .default("yaml")
        .describe("Export format"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, format, cdpPort, cdpHost, allowRemote }) => {
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

          const config =
            format === "json"
              ? serializeCampaignJson(campaign, actions)
              : serializeCampaignYaml(campaign, actions);

          return mcpSuccess(
            JSON.stringify(
              { campaignId, format, config },
              null,
              2,
            ),
          );
        });
      } catch (error) {
        return mcpCatchAll(error, "Failed to export campaign");
      }
    },
  );
}
