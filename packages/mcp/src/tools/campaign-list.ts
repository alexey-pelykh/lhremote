// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  campaignList,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-list | campaign-list} MCP tool. */
export function registerCampaignList(server: McpServer): void {
  server.tool(
    "campaign-list",
    "List existing LinkedHelper campaigns with summary statistics",
    {
      includeArchived: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include archived campaigns"),
      ...cdpConnectionSchema,
    },
    async ({ includeArchived, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await campaignList({ includeArchived, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to list campaigns");
      }
    },
  );
}
