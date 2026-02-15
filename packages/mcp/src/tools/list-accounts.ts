// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LauncherService } from "@lhremote/core";
import { buildCdpOptions, cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#list-accounts | list-accounts} MCP tool. */
export function registerListAccounts(server: McpServer): void {
  server.tool(
    "list-accounts",
    "List available LinkedHelper accounts",
    {
      ...cdpConnectionSchema,
    },
    async ({ cdpPort, cdpHost, allowRemote }) => {
      const launcher = new LauncherService(cdpPort, buildCdpOptions({ cdpHost, allowRemote }));

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
