// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
  campaignUpdateAction,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-update-action | campaign-update-action} MCP tool. */
export function registerCampaignUpdateAction(server: McpServer): void {
  server.tool(
    "campaign-update-action",
    "Update an existing action's configuration in a campaign (partial update — only provided fields are changed)",
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
        .describe("Action ID to update"),
      name: z
        .string()
        .optional()
        .describe("New display name for the action"),
      description: z
        .string()
        .nullable()
        .optional()
        .describe("New action description (null to clear)"),
      coolDown: z
        .number()
        .int()
        .optional()
        .describe("Milliseconds between action executions"),
      maxActionResultsPerIteration: z
        .number()
        .int()
        .optional()
        .describe("Maximum results per iteration (-1 for unlimited)"),
      actionSettings: z
        .string()
        .optional()
        .describe("Action-specific settings as a JSON string (merged with existing settings)"),
      ...cdpConnectionSchema,
    },
    async ({
      campaignId,
      actionId,
      name,
      description,
      coolDown,
      maxActionResultsPerIteration,
      actionSettings,
      cdpPort,
      cdpHost,
      allowRemote,
    }) => {
      // Parse action settings JSON if provided
      let parsedSettings: Record<string, unknown> | undefined;
      if (actionSettings !== undefined) {
        try {
          parsedSettings = JSON.parse(actionSettings) as Record<string, unknown>;
        } catch {
          return mcpError("Invalid JSON in actionSettings.");
        }
      }

      try {
        const result = await campaignUpdateAction({
          campaignId, actionId, name, description, coolDown,
          maxActionResultsPerIteration, actionSettings: parsedSettings,
          cdpPort, cdpHost, allowRemote,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof ActionNotFoundError) {
          return mcpError(`Action ${String(actionId)} not found in campaign ${String(campaignId)}.`);
        }
        return mcpCatchAll(error, "Failed to update action");
      }
    },
  );
}
