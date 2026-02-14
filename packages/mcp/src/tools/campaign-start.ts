// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignExecutionError,
  CampaignService,
  CampaignTimeoutError,
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

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-start | campaign-start} MCP tool. */
export function registerCampaignStart(server: McpServer): void {
  server.tool(
    "campaign-start",
    "Start a campaign with specified target persons. Returns immediately (async execution).",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to target"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, personIds, cdpPort, cdpHost, allowRemote }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort, buildCdpOptions({ cdpHost, allowRemote }));
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
          const campaignService = new CampaignService(instance, db);
          await campaignService.start(campaignId, personIds);

          return mcpSuccess(
            JSON.stringify(
              {
                success: true,
                campaignId,
                personsQueued: personIds.length,
                message:
                  "Campaign started. Use campaign-status to monitor progress.",
              },
              null,
              2,
            ),
          );
        });
      } catch (error) {
        if (error instanceof CampaignTimeoutError) {
          return mcpError(`Campaign start timed out: ${error.message}`);
        }
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to start campaign: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to start campaign");
      }
    },
  );
}
