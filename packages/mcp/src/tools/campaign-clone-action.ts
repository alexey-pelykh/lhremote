// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ActionNotFoundError, campaignCloneAction } from "@insoftex/lhremote-core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the campaign-clone-action MCP tool. */
export function registerCampaignCloneAction(server: McpServer): void {
  server.tool(
    "campaign-clone-action",
    "Duplicate an existing campaign action/node, preserving its type, cooldown, max results, and settings with optional overrides",
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
        .describe("Source action ID to clone"),
      name: z
        .string()
        .optional()
        .describe("Name for the cloned action (default: '<source name> copy')"),
      description: z
        .string()
        .nullable()
        .optional()
        .describe("Description for the cloned action. Omit to preserve the source description."),
      actionSettingsOverrides: z
        .string()
        .optional()
        .describe("JSON object with actionSettings keys to merge into the cloned action"),
      ...cdpConnectionSchema,
    },
    async ({
      campaignId,
      actionId,
      name,
      description,
      actionSettingsOverrides,
      cdpPort,
      cdpHost,
      allowRemote,
      accountId,
    }) => {
      let parsedOverrides: Record<string, unknown> | undefined;
      if (actionSettingsOverrides !== undefined) {
        try {
          const parsed = JSON.parse(actionSettingsOverrides) as unknown;
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return mcpError("actionSettingsOverrides must be a JSON object.");
          }
          parsedOverrides = parsed as Record<string, unknown>;
        } catch {
          return mcpError("Invalid JSON in actionSettingsOverrides.");
        }
      }

      try {
        const result = await campaignCloneAction({
          campaignId,
          actionId,
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(parsedOverrides !== undefined && { actionSettingsOverrides: parsedOverrides }),
          cdpPort,
          cdpHost,
          allowRemote,
          accountId,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof ActionNotFoundError) {
          return mcpError(`Action ${String(actionId)} not found in campaign ${String(campaignId)}.`);
        }
        return mcpCatchAll(error, "Failed to clone campaign action");
      }
    },
  );
}
