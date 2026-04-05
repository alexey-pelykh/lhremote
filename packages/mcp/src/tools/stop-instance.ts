// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  LauncherService,
  resolveLauncherPort,
} from "@lhremote/core";
import { buildCdpOptions, cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#stop-instance | stop-instance} MCP tool. */
export function registerStopInstance(server: McpServer): void {
  server.tool(
    "stop-instance",
    "Stop a running LinkedHelper instance",
    {
      ...cdpConnectionSchema,
    },
    async ({ accountId, cdpPort, cdpHost, allowRemote }) => {
      try {
        const port = await resolveLauncherPort(cdpPort, cdpHost);
        const launcher = new LauncherService(port, buildCdpOptions({ cdpHost, allowRemote }));

        try {
          await launcher.connect();
        } catch (error) {
          return mcpCatchAll(error, "Failed to connect to LinkedHelper");
        }

        try {
          let resolvedId = accountId;

          if (resolvedId === undefined) {
            const accounts = await launcher.listAccounts();
            if (accounts.length === 0) {
              return mcpError("No accounts found.");
            }
            if (accounts.length > 1) {
              return mcpError(
                "Multiple accounts found. Specify accountId. Use list-accounts to see available accounts.",
              );
            }
            resolvedId = (accounts[0] as Account).id;
          }

          await launcher.stopInstance(resolvedId);

          return mcpSuccess(
            `Instance stopped for account ${String(resolvedId)}`,
          );
        } catch (error) {
          return mcpCatchAll(error, "Failed to stop instance");
        } finally {
          launcher.disconnect();
        }
      } catch (error) {
        return mcpCatchAll(error, "Failed to stop instance");
      }
    },
  );
}
