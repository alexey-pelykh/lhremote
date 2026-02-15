// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  LauncherService,
} from "@lhremote/core";
import { z } from "zod";
import { buildCdpOptions, cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#stop-instance | stop-instance} MCP tool. */
export function registerStopInstance(server: McpServer): void {
  server.tool(
    "stop-instance",
    "Stop a running LinkedHelper instance",
    {
      accountId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Account ID (omit to stop the only running instance)",
        ),
      ...cdpConnectionSchema,
    },
    async ({ accountId, cdpPort, cdpHost, allowRemote }) => {
      const launcher = new LauncherService(cdpPort, buildCdpOptions({ cdpHost, allowRemote }));

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
    },
  );
}
