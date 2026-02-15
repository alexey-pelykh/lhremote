// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
  CampaignExecutionError,
  campaignRemoveAction,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

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
      try {
        const result = await campaignRemoveAction({ campaignId, actionId, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
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
