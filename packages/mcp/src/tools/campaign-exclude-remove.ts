// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
  ExcludeListNotFoundError,
  campaignExcludeRemove,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-exclude-remove | campaign-exclude-remove} MCP tool. */
export function registerCampaignExcludeRemove(server: McpServer): void {
  server.tool(
    "campaign-exclude-remove",
    "Remove people from a campaign or action exclude list",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to remove from the exclude list"),
      actionId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Action ID (optional). If provided, removes from the action-level exclude list. Otherwise, removes from the campaign-level exclude list.",
        ),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, personIds, actionId, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await campaignExcludeRemove({ campaignId, personIds, actionId, cdpPort, cdpHost, allowRemote });
        const targetLabel = actionId !== undefined
          ? `action ${String(actionId)} in campaign ${String(campaignId)}`
          : `campaign ${String(campaignId)}`;
        return mcpSuccess(JSON.stringify({ ...result, message: `Removed ${String(result.removed)} person(s) from exclude list for ${targetLabel}.` }, null, 2));
      } catch (error) {
        if (error instanceof ActionNotFoundError) {
          return mcpError(`Action ${String(actionId)} not found in campaign ${String(campaignId)}.`);
        }
        if (error instanceof ExcludeListNotFoundError) {
          return mcpError(error.message);
        }
        return mcpCatchAll(error, "Failed to remove from exclude list");
      }
    },
  );
}
