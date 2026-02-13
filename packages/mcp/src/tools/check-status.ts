// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkStatus, DEFAULT_CDP_PORT } from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#check-status | check-status} MCP tool. */
export function registerCheckStatus(server: McpServer): void {
  server.tool(
    "check-status",
    "Check LinkedHelper connection status, running instances, and database health",
    {
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(DEFAULT_CDP_PORT)
        .describe("CDP port"),
      cdpHost: z
        .string()
        .optional()
        .describe("CDP host (default: 127.0.0.1)"),
      allowRemote: z
        .boolean()
        .optional()
        .describe("Allow non-loopback CDP connections"),
    },
    async ({ cdpPort, cdpHost, allowRemote }) => {
      try {
        const report = await checkStatus(cdpPort, { ...(cdpHost !== undefined && { host: cdpHost }), ...(allowRemote !== undefined && { allowRemote }) });

        return mcpSuccess(JSON.stringify(report, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to check status");
      }
    },
  );
}
