// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignExecutionError,
  CampaignTimeoutError,
  campaignStart,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-start | campaign-start} MCP tool. */
export function registerCampaignStart(server: McpServer): void {
  server.tool(
    "campaign-start",
    "Start a campaign with specified target persons. Returns immediately (async execution).",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to target"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, personIds, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await campaignStart({ campaignId, personIds, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof CampaignTimeoutError) {
          return mcpError(`Campaign start timed out: ${error.message}`);
        }
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to start campaign: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to start campaign");
      }
    },
  );
}
