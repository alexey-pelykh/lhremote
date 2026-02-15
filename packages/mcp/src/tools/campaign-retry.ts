// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  campaignRetry,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-retry | campaign-retry} MCP tool. */
export function registerCampaignRetry(server: McpServer): void {
  server.tool(
    "campaign-retry",
    "Reset specified people for re-run in a campaign (three-table reset without starting the campaign)",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to reset for retry"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, personIds, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await campaignRetry({ campaignId, personIds, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to reset persons for retry");
      }
    },
  );
}
