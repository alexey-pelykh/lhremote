// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scanOrphans, scanRunningInstances } from "@insoftex/lhremote-core";
import { mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the list-orphans MCP tool. */
export function registerListOrphans(server: McpServer): void {
  server.tool(
    "list-orphans",
    "List orphaned LinkedHelper account-instance processes: non-connectable instance-side processes that are not live instances for any account. Helper children (--type= processes) are never orphans.",
    {},
    async () => {
      try {
        const liveInstances = await scanRunningInstances();
        const orphans = await scanOrphans(liveInstances);

        if (orphans.length === 0) {
          return mcpSuccess("No orphaned processes detected.");
        }

        return mcpSuccess(JSON.stringify(orphans, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to list orphans");
      }
    },
  );
}
