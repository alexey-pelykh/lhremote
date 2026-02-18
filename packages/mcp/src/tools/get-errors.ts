// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getErrors } from "@lhremote/core";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#get-errors | get-errors} MCP tool. */
export function registerGetErrors(server: McpServer): void {
  server.tool(
    "get-errors",
    "Query current LinkedHelper UI errors, dialogs, and blocking popups. Returns instance issues (dialog and critical-error), popup overlay state, and overall health status.",
    {
      ...cdpConnectionSchema,
    },
    async ({ cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await getErrors({ cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to get errors");
      }
    },
  );
}
