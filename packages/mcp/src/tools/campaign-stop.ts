// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignExecutionError,
  campaignStop,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-stop | campaign-stop} MCP tool. */
export function registerCampaignStop(server: McpServer): void {
  server.tool(
    "campaign-stop",
    "Stop a running campaign",
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
        const result = await campaignStop({ campaignId, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to stop campaign: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to stop campaign");
      }
    },
  );
}
