// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignExecutionError,
  campaignStatus,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-status | campaign-status} MCP tool. */
export function registerCampaignStatus(server: McpServer): void {
  server.tool(
    "campaign-status",
    "Check campaign execution status and results. Use after campaign-start to monitor progress.",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      includeResults: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include execution results"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .default(20)
        .describe("Max results to return"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, includeResults, limit, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await campaignStatus({
          campaignId,
          includeResults,
          limit,
          cdpPort,
          cdpHost,
          allowRemote,
        });

        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to get campaign status: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to get campaign status");
      }
    },
  );
}
