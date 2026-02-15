// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  campaignAddAction,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-add-action | campaign-add-action} MCP tool. */
export function registerCampaignAddAction(server: McpServer): void {
  server.tool(
    "campaign-add-action",
    "Add a new action to an existing campaign's action chain",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      name: z
        .string()
        .describe("Display name for the action"),
      actionType: z
        .string()
        .describe("Action type identifier (e.g., 'VisitAndExtract', 'MessageToPerson')"),
      description: z
        .string()
        .optional()
        .describe("Optional action description"),
      coolDown: z
        .number()
        .int()
        .optional()
        .describe("Milliseconds between action executions (default: 60000)"),
      maxActionResultsPerIteration: z
        .number()
        .int()
        .optional()
        .describe("Maximum results per iteration (default: 10, -1 for unlimited)"),
      actionSettings: z
        .string()
        .optional()
        .describe("Action-specific settings as a JSON string"),
      ...cdpConnectionSchema,
    },
    async ({
      campaignId,
      name,
      actionType,
      description,
      coolDown,
      maxActionResultsPerIteration,
      actionSettings,
      cdpPort,
      cdpHost,
      allowRemote,
    }) => {
      // Parse action settings JSON if provided
      let parsedSettings: Record<string, unknown> = {};
      if (actionSettings !== undefined) {
        try {
          parsedSettings = JSON.parse(actionSettings) as Record<string, unknown>;
        } catch {
          return mcpError("Invalid JSON in actionSettings.");
        }
      }

      try {
        const result = await campaignAddAction({
          campaignId, name, actionType, description, coolDown,
          maxActionResultsPerIteration, actionSettings: parsedSettings,
          cdpPort, cdpHost, allowRemote,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to add action to campaign");
      }
    },
  );
}
