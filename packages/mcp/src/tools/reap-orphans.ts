// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reapOrphans, scanOrphans, scanRunningInstances } from "@insoftex/lhremote-core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the reap-orphans MCP tool. */
export function registerReapOrphans(server: McpServer): void {
  server.tool(
    "reap-orphans",
    "Terminate orphaned LinkedHelper account-instance processes. Dry-run by default — set confirm: true to actually kill processes. Never touches connectable instances, the launcher, or helper children of live parents.",
    {
      confirm: z
        .boolean()
        .optional()
        .describe(
          "Set to true to actually terminate orphans. Omit or set false for a dry-run that shows what would be killed.",
        ),
    },
    async ({ confirm }) => {
      try {
        const liveInstances = await scanRunningInstances();
        const orphans = await scanOrphans(liveInstances);

        if (orphans.length === 0) {
          return mcpSuccess("No orphaned processes to reap.");
        }

        if (!confirm) {
          return mcpSuccess(
            `Dry-run: would terminate ${String(orphans.length)} orphan(s):\n${JSON.stringify(orphans, null, 2)}\n\nSet confirm: true to proceed.`,
          );
        }

        const results = await reapOrphans(orphans, true);

        const killed = results.filter((r) => r.action === "killed").length;
        const skipped = results.filter((r) => r.action === "skipped").length;

        if (killed === 0 && skipped > 0) {
          return mcpError(
            `Failed to terminate all ${String(skipped)} orphan(s):\n${JSON.stringify(results, null, 2)}`,
          );
        }

        return mcpSuccess(
          `Terminated ${String(killed)} orphan(s)${skipped > 0 ? `, ${String(skipped)} failed` : ""}:\n${JSON.stringify(results, null, 2)}`,
        );
      } catch (error) {
        return mcpCatchAll(error, "Failed to reap orphans");
      }
    },
  );
}
