// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  LauncherService,
  resolveLauncherPort,
  waitForInstanceShutdown,
  withLauncherQueue,
  withLauncherRecovery,
} from "@insoftex/lhremote-core";
import { buildCdpOptions, cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/insoftex-company/insoftex-lhremote#stop-instance | stop-instance} MCP tool. */
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
          // Phase 1: resolve account ID (auto-select when not provided).
          let resolvedId = accountId;

          if (resolvedId === undefined) {
            const { result: accounts } = await withLauncherRecovery(
              launcher,
              () => launcher.listAccounts(),
            );

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

          // Phase 2: stop through the launcher queue (T1/T5).
          // Settle barrier waits for the launcher to recover after the stop.
          await withLauncherQueue(
            () =>
              withLauncherRecovery(
                launcher,
                async () => {
                  await launcher.stopInstance(resolvedId as number);
                  // Confirm the instance port has actually disappeared (T5).
                  await waitForInstanceShutdown(port);
                },
              ),
            { type: "stop", launcherPort: port },
          );

          return mcpSuccess(`Instance stopped for account ${resolvedId}`);
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
