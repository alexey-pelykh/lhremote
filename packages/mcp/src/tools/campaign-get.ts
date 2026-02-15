// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  campaignGet,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-get | campaign-get} MCP tool. */
export function registerCampaignGet(server: McpServer): void {
  server.tool(
    "campaign-get",
    "Get detailed information about a campaign including its actions and configuration",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await campaignGet({ campaignId, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to get campaign");
      }
    },
  );
}
