// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignExecutionError,
  campaignDelete,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-delete | campaign-delete} MCP tool. */
export function registerCampaignDelete(server: McpServer): void {
  server.tool(
    "campaign-delete",
    "Delete a campaign. By default archives (soft delete). Use hard: true to permanently remove all data.",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      hard: z
        .boolean()
        .optional()
        .describe("Permanently delete the campaign and all related data instead of archiving"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, hard, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await campaignDelete({ campaignId, hard, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to delete campaign: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to delete campaign");
      }
    },
  );
}
