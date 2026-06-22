// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  LauncherService,
  resolveLauncherPort,
  restartInstance,
} from "@insoftex/lhremote-core";
import { buildCdpOptions, cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the restart-instance MCP tool. */
export function registerRestartInstance(server: McpServer): void {
  server.tool(
    "restart-instance",
    "Restart a single LinkedHelper account instance cleanly. " +
      "Stops the running process, waits for it to exit, starts it again, " +
      "and waits until it is connectable on a verified distinct port. " +
      "Idempotent: if the instance is already healthy, returns restarted:false " +
      "without touching it (unless force:true). " +
      "Only the target account's process is affected — other instances keep running.",
    {
      ...cdpConnectionSchema,
      force: z
        .boolean()
        .optional()
        .describe(
          "Restart even when the instance is already connectable and healthy. Default: false.",
        ),
    },
    async ({ accountId, cdpPort, cdpHost, allowRemote, force }) => {
      try {
        if (accountId === undefined) {
          return {
            content: [{ type: "text", text: "accountId is required for restart-instance" }],
            isError: true,
          };
        }

        const port = await resolveLauncherPort(cdpPort, cdpHost);
        const launcher = new LauncherService(
          port,
          buildCdpOptions({ cdpHost, allowRemote }),
        );

        try {
          await launcher.connect();
        } catch (error) {
          return mcpCatchAll(error, "Failed to connect to LinkedHelper");
        }

        try {
          const result = await restartInstance(launcher, accountId, port, {
            force: force ?? false,
          });

          return mcpSuccess(JSON.stringify(result, null, 2));
        } catch (error) {
          return mcpCatchAll(error, "Failed to restart instance");
        } finally {
          launcher.disconnect();
        }
      } catch (error) {
        return mcpCatchAll(error, "Failed to restart instance");
      }
    },
  );
}
