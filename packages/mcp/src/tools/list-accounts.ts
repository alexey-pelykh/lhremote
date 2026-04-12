// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LauncherService, resolveLauncherPort } from "@lhremote/core";
import { z } from "zod";
import { buildCdpOptions, cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#list-accounts | list-accounts} MCP tool. */
export function registerListAccounts(server: McpServer): void {
  server.tool(
    "list-accounts",
    "List available LinkedHelper accounts. By default returns accounts in the currently selected workspace (LinkedHelper 2.113.x+). Pass includeAllWorkspaces=true to enumerate accounts across every workspace the current LH user belongs to.",
    {
      ...cdpConnectionSchema,
      includeAllWorkspaces: z
        .boolean()
        .optional()
        .describe(
          "When true, enumerate accounts across every workspace the user belongs to, not just the selected workspace. Default: false.",
        ),
    },
    async ({ cdpPort, cdpHost, allowRemote, includeAllWorkspaces }) => {
      try {
        const port = await resolveLauncherPort(cdpPort, cdpHost);
        const launcher = new LauncherService(port, buildCdpOptions({ cdpHost, allowRemote }));

        try {
          await launcher.connect();
        } catch (error) {
          return mcpCatchAll(error, "Failed to connect to LinkedHelper");
        }

        try {
          const options = includeAllWorkspaces === true
            ? { includeAllWorkspaces: true }
            : undefined;
          const accounts = await launcher.listAccounts(options);
          return mcpSuccess(JSON.stringify(accounts, null, 2));
        } catch (error) {
          return mcpCatchAll(error, "Failed to list accounts");
        } finally {
          launcher.disconnect();
        }
      } catch (error) {
        return mcpCatchAll(error, "Failed to list accounts");
      }
    },
  );
}
