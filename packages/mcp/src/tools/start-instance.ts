// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  LauncherService,
  resolveLauncherPort,
  startInstanceWithRecovery,
  withLauncherQueue,
  withLauncherRecovery,
} from "@insoftex/lhremote-core";
import { buildCdpOptions, cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/insoftex-company/insoftex-lhremote#start-instance | start-instance} MCP tool. */
export function registerStartInstance(server: McpServer): void {
  server.tool(
    "start-instance",
    "Start a LinkedHelper instance for a LinkedIn account. Required before campaign or query operations.",
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

          // Phase 2: start through the launcher queue (T1/T5).
          // The settle barrier waits for the launcher to recover and the
          // instance to become connectable before releasing the queue.
          const { result: outcome } =
            await withLauncherQueue(
              () =>
                withLauncherRecovery(
                  launcher,
                  () => startInstanceWithRecovery(launcher, resolvedId as number, port),
                ),
              { type: "start", accountId: resolvedId as number, launcherPort: port },
            );

          if (outcome.status === "timeout") {
            return mcpError(
              "Instance started but failed to initialize within timeout.",
            );
          }

          const verb = outcome.status === "already_running" ? "already running" : "started";
          let text = `Instance ${verb} for account ${resolvedId} on CDP port ${outcome.port}`;
          if (outcome.pid !== undefined) text += ` — PID ${outcome.pid}`;
          if (outcome.verified === true) text += " — verified";
          else if (outcome.verified === false) text += " — NOT verified — duplicate port suspected";
          return mcpSuccess(text);
        } catch (error) {
          return mcpCatchAll(error, "Failed to start instance");
        } finally {
          launcher.disconnect();
        }
      } catch (error) {
        return mcpCatchAll(error, "Failed to start instance");
      }
    },
  );
}
