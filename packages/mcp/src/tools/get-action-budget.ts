// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getActionBudget } from "@lhremote/core";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#get-action-budget | get-action-budget} MCP tool. */
export function registerGetActionBudget(server: McpServer): void {
  server.tool(
    "get-action-budget",
    "Get daily action budget showing limit types, thresholds, and today's usage from LH campaigns and CDP-direct actions.",
    {
      ...cdpConnectionSchema,
    },
    async ({ cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await getActionBudget({ cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to get action budget");
      }
    },
  );
}
