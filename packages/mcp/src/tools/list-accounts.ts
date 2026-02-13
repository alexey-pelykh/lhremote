// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DEFAULT_CDP_PORT,
  LauncherService,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#list-accounts | list-accounts} MCP tool. */
export function registerListAccounts(server: McpServer): void {
  server.tool(
    "list-accounts",
    "List available LinkedHelper accounts",
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
      const launcher = new LauncherService(cdpPort, { ...(cdpHost !== undefined && { host: cdpHost }), ...(allowRemote !== undefined && { allowRemote }) });

      try {
        await launcher.connect();
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        const accounts = await launcher.listAccounts();
        return mcpSuccess(JSON.stringify(accounts, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to list accounts");
      } finally {
        launcher.disconnect();
      }
    },
  );
}
