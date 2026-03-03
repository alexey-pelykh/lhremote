// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignExecutionError,
  campaignRemovePeople,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-remove-people | campaign-remove-people} MCP tool. */
export function registerCampaignRemovePeople(server: McpServer): void {
  server.tool(
    "campaign-remove-people",
    "Remove people from a campaign's target list entirely (not just exclude from processing). This is the inverse of import-people-from-urls.",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID to remove people from"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to remove from the campaign target list"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, personIds, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await campaignRemovePeople({ campaignId, personIds, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to remove people: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to remove people");
      }
    },
  );
}
