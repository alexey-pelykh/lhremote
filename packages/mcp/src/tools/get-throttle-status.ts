// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getThrottleStatus } from "@lhremote/core";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#get-throttle-status | get-throttle-status} MCP tool. */
export function registerGetThrottleStatus(server: McpServer): void {
  server.tool(
    "get-throttle-status",
    "Check if LinkedIn is currently throttling the account via LH's ThrottleDetector.",
    {
      ...cdpConnectionSchema,
    },
    async ({ cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await getThrottleStatus({ cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to get throttle status");
      }
    },
  );
}
