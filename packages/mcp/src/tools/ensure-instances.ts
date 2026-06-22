// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LauncherService, ensureInstances, resolveLauncherPort } from "@insoftex/lhremote-core";
import { z } from "zod";
import { buildCdpOptions, cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the ensure-instances MCP tool. */
export function registerEnsureInstances(server: McpServer): void {
  server.tool(
    "ensure-instances",
    "Idempotently bring up the specified set of LinkedHelper account instances. Skips accounts that already have a verified-running instance; starts the rest one at a time with verification between each. Returns a per-account result table.",
    {
      accountIds: z
        .array(z.number().int().positive())
        .min(1)
        .describe("List of account IDs that should be running."),
      ...cdpConnectionSchema,
    },
    async ({ accountIds, cdpPort, cdpHost, allowRemote }) => {
      try {
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
          const results = await ensureInstances(accountIds, launcher, port);
          return mcpSuccess(JSON.stringify(results, null, 2));
        } catch (error) {
          return mcpCatchAll(error, "Failed to ensure instances");
        } finally {
          launcher.disconnect();
        }
      } catch (error) {
        return mcpCatchAll(error, "Failed to ensure instances");
      }
    },
  );
}
