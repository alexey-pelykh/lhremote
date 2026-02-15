// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
  ExcludeListNotFoundError,
  campaignExcludeAdd,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-exclude-add | campaign-exclude-add} MCP tool. */
export function registerCampaignExcludeAdd(server: McpServer): void {
  server.tool(
    "campaign-exclude-add",
    "Add people to a campaign or action exclude list",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to add to the exclude list"),
      actionId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Action ID (optional). If provided, adds to the action-level exclude list. Otherwise, adds to the campaign-level exclude list.",
        ),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, personIds, actionId, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await campaignExcludeAdd({ campaignId, personIds, actionId, cdpPort, cdpHost, allowRemote });
        const targetLabel = actionId !== undefined
          ? `action ${String(actionId)} in campaign ${String(campaignId)}`
          : `campaign ${String(campaignId)}`;
        return mcpSuccess(JSON.stringify({ ...result, message: `Added ${String(result.added)} person(s) to exclude list for ${targetLabel}.` }, null, 2));
      } catch (error) {
        if (error instanceof ActionNotFoundError) {
          return mcpError(`Action ${String(actionId)} not found in campaign ${String(campaignId)}.`);
        }
        if (error instanceof ExcludeListNotFoundError) {
          return mcpError(error.message);
        }
        return mcpCatchAll(error, "Failed to add to exclude list");
      }
    },
  );
}
