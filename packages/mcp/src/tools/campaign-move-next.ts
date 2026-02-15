// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
  NoNextActionError,
  campaignMoveNext,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-move-next | campaign-move-next} MCP tool. */
export function registerCampaignMoveNext(server: McpServer): void {
  server.tool(
    "campaign-move-next",
    "Move people from one action to the next action in a campaign chain (without executing the current action)",
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
        .describe("Action ID to move people from"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to advance to the next action"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, actionId, personIds, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await campaignMoveNext({ campaignId, actionId, personIds, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof ActionNotFoundError) {
          return mcpError(`Action ${String(actionId)} not found in campaign ${String(campaignId)}.`);
        }
        if (error instanceof NoNextActionError) {
          return mcpError(`Action ${String(actionId)} is the last action in campaign ${String(campaignId)}.`);
        }
        return mcpCatchAll(error, "Failed to move persons to next action");
      }
    },
  );
}
