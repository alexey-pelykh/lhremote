// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkStatus } from "@lhremote/core";
import { buildCdpOptions, cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#check-status | check-status} MCP tool. */
export function registerCheckStatus(server: McpServer): void {
  server.tool(
    "check-status",
    "Check LinkedHelper connection status, running instances, and database health",
    {
      ...cdpConnectionSchema,
    },
    async ({ cdpPort, cdpHost, allowRemote }) => {
      try {
        const report = await checkStatus(cdpPort, buildCdpOptions({ cdpHost, allowRemote }));

        return mcpSuccess(JSON.stringify(report, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to check status");
      }
    },
  );
}
