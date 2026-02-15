// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  campaignExport,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-export | campaign-export} MCP tool. */
export function registerCampaignExport(server: McpServer): void {
  server.tool(
    "campaign-export",
    "Export a campaign configuration as YAML or JSON for backup or reuse",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      format: z
        .enum(["yaml", "json"])
        .optional()
        .default("yaml")
        .describe("Export format"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, format, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await campaignExport({ campaignId, format, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to export campaign");
      }
    },
  );
}
