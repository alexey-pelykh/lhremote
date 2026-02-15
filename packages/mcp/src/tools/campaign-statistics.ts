// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
  CampaignStatisticsRepository,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import {
  buildCdpOptions,
  cdpConnectionSchema,
  mcpCatchAll,
  mcpError,
  mcpSuccess,
} from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-statistics | campaign-statistics} MCP tool. */
export function registerCampaignStatistics(server: McpServer): void {
  server.tool(
    "campaign-statistics",
    "Get per-action success/failure/skip rates, top error codes with blame attribution, and processing timeline for a campaign.",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      actionId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Filter to a specific action ID"),
      maxErrors: z
        .number()
        .int()
        .positive()
        .optional()
        .default(5)
        .describe("Maximum number of top errors per action (default: 5)"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, actionId, maxErrors, cdpPort, cdpHost, allowRemote }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort, buildCdpOptions({ cdpHost, allowRemote }));
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withDatabase(accountId, ({ db }) => {
          const statisticsRepo = new CampaignStatisticsRepository(db);
          const statsOptions: { actionId?: number; maxErrors?: number } = { maxErrors };
          if (actionId !== undefined) statsOptions.actionId = actionId;
          const statistics = statisticsRepo.getStatistics(campaignId, statsOptions);

          return mcpSuccess(JSON.stringify(statistics, null, 2));
        });
      } catch (error) {
        if (error instanceof ActionNotFoundError) {
          return mcpError(`Action ${String(actionId)} not found in campaign ${String(campaignId)}.`);
        }
        return mcpCatchAll(error, "Failed to get campaign statistics");
      }
    },
  );
}
