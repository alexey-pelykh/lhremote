// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignNotFoundError,
  CampaignRepository,
  DEFAULT_CDP_PORT,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

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
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(DEFAULT_CDP_PORT)
        .describe("CDP port"),
      cdpHost: z
        .string()
        .optional()
        .describe("CDP host (default: 127.0.0.1)"),
      allowRemote: z
        .boolean()
        .optional()
        .describe("Allow non-loopback CDP connections"),
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

      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort, { ...(cdpHost !== undefined && { host: cdpHost }), ...(allowRemote !== undefined && { allowRemote }) });
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withDatabase(accountId, ({ db }) => {
          const campaignRepo = new CampaignRepository(db);
          const campaign = campaignRepo.getCampaign(campaignId);

          const actionConfig: import("@lhremote/core").CampaignActionConfig = {
            name,
            actionType,
            actionSettings: parsedSettings,
          };
          if (description !== undefined) {
            actionConfig.description = description;
          }
          if (coolDown !== undefined) {
            actionConfig.coolDown = coolDown;
          }
          if (maxActionResultsPerIteration !== undefined) {
            actionConfig.maxActionResultsPerIteration =
              maxActionResultsPerIteration;
          }

          const action = campaignRepo.addAction(
            campaignId,
            actionConfig,
            campaign.liAccountId,
          );

          return mcpSuccess(JSON.stringify(action, null, 2));
        }, { readOnly: false });
      } catch (error) {
        if (error instanceof CampaignNotFoundError) {
          return mcpError(`Campaign ${String(campaignId)} not found.`);
        }
        return mcpCatchAll(error, "Failed to add action to campaign");
      }
    },
  );
}
