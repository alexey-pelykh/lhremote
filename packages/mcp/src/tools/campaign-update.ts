// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  campaignUpdate,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-update | campaign-update} MCP tool. */
export function registerCampaignUpdate(server: McpServer): void {
  server.tool(
    "campaign-update",
    "Update a campaign's name and/or description",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      name: z
        .string()
        .optional()
        .describe("New campaign name"),
      description: z
        .string()
        .nullable()
        .optional()
        .describe("New campaign description (null to clear)"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, name, description, cdpPort, cdpHost, allowRemote }) => {
      // Validate that at least one field is provided
      if (name === undefined && description === undefined) {
        return mcpError("At least one of name or description must be provided.");
      }

      const updates: { name?: string; description?: string | null } = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;

      try {
        const result = await campaignUpdate({ campaignId, updates, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to update campaign");
      }
    },
  );
}
