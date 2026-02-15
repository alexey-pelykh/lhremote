// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
  CampaignExecutionError,
  campaignReorderActions,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-reorder-actions | campaign-reorder-actions} MCP tool. */
export function registerCampaignReorderActions(server: McpServer): void {
  server.tool(
    "campaign-reorder-actions",
    "Reorder actions in a campaign's action chain",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      actionIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Action IDs in the desired order"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, actionIds, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await campaignReorderActions({ campaignId, actionIds, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof ActionNotFoundError) {
          return mcpError(`One or more action IDs not found in campaign ${String(campaignId)}.`);
        }
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to reorder actions: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to reorder actions");
      }
    },
  );
}
