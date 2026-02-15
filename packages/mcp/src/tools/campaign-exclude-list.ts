// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
  ExcludeListNotFoundError,
  campaignExcludeList,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-exclude-list | campaign-exclude-list} MCP tool. */
export function registerCampaignExcludeList(server: McpServer): void {
  server.tool(
    "campaign-exclude-list",
    "View the exclude list for a campaign or a specific action within a campaign",
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
        .describe(
          "Action ID (optional). If provided, shows the action-level exclude list. Otherwise, shows the campaign-level exclude list.",
        ),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, actionId, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await campaignExcludeList({ campaignId, actionId, cdpPort, cdpHost, allowRemote });
        const targetLabel = actionId !== undefined
          ? `action ${String(actionId)} in campaign ${String(campaignId)}`
          : `campaign ${String(campaignId)}`;
        return mcpSuccess(JSON.stringify({ ...result, message: `Exclude list for ${targetLabel}: ${String(result.count)} person(s).` }, null, 2));
      } catch (error) {
        if (error instanceof ActionNotFoundError) {
          return mcpError(`Action ${String(actionId)} not found in campaign ${String(campaignId)}.`);
        }
        if (error instanceof ExcludeListNotFoundError) {
          return mcpError(error.message);
        }
        return mcpCatchAll(error, "Failed to get exclude list");
      }
    },
  );
}
