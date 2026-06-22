// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getActionTypeInfo, validateActionSettings } from "@insoftex/lhremote-core";
import { z } from "zod";
import { mcpError, mcpSuccess } from "../helpers.js";

/** Register the campaign-validate-action-settings MCP tool. */
export function registerCampaignValidateActionSettings(server: McpServer): void {
  server.tool(
    "campaign-validate-action-settings",
    "Validate actionSettings JSON against the known LinkedHelper action schema before adding or updating a campaign action",
    {
      actionType: z
        .string()
        .describe("LinkedHelper action type identifier, e.g. VisitAndExtract or MessageToPerson"),
      actionSettings: z
        .string()
        .optional()
        .default("{}")
        .describe("Action-specific settings as a JSON object string"),
    },
    async ({ actionType, actionSettings }) => {
      let parsedSettings: Record<string, unknown>;
      try {
        const parsed = JSON.parse(actionSettings) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return mcpError("actionSettings must be a JSON object.");
        }
        parsedSettings = parsed as Record<string, unknown>;
      } catch {
        return mcpError("Invalid JSON in actionSettings.");
      }

      const validation = validateActionSettings(actionType, parsedSettings);
      const actionInfo = getActionTypeInfo(actionType);
      return mcpSuccess(JSON.stringify({
        ...validation,
        schema: actionInfo?.configSchema ?? null,
        example: actionInfo?.example ?? null,
      }, null, 2));
    },
  );
}
