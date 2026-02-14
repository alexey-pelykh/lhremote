// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
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

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-remove-action | campaign-remove-action} MCP tool. */
export function registerCampaignRemoveAction(server: McpServer): void {
  server.tool(
    "campaign-remove-action",
    "Remove an action from a campaign's action chain",
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
        .describe("Action ID to remove"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, actionId, cdpPort, cdpHost, allowRemote }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort, buildCdpOptions({ cdpHost, allowRemote }));
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
          const campaignService = new CampaignService(instance, db);
          await campaignService.removeAction(campaignId, actionId);

          return mcpSuccess(
            JSON.stringify(
              {
                success: true,
                campaignId,
                removedActionId: actionId,
              },
              null,
              2,
            ),
          );
        });
      } catch (error) {
        if (error instanceof ActionNotFoundError) {
          return mcpError(`Action ${String(actionId)} not found in campaign ${String(campaignId)}.`);
        }
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to remove action: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to remove action");
      }
    },
  );
}
