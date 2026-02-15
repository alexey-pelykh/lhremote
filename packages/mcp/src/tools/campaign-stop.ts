// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignExecutionError,
  CampaignService,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";
import { z } from "zod";
import {
  buildCdpOptions,
  cdpConnectionSchema,
  mcpCatchAll,
  mcpError,
  mcpSuccess,
} from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-stop | campaign-stop} MCP tool. */
export function registerCampaignStop(server: McpServer): void {
  server.tool(
    "campaign-stop",
    "Stop a running campaign",
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
        return await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
          const campaignService = new CampaignService(instance, db);
          await campaignService.stop(campaignId);

          return mcpSuccess(
            JSON.stringify(
              {
                success: true,
                campaignId,
                message: "Campaign paused",
              },
              null,
              2,
            ),
          );
        });
      } catch (error) {
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to stop campaign: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to stop campaign");
      }
    },
  );
}
