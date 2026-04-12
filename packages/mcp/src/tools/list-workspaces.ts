// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LauncherService, resolveLauncherPort } from "@lhremote/core";
import { buildCdpOptions, cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/**
 * Register the list-workspaces MCP tool.
 *
 * Workspaces are a LinkedHelper 2.113.x feature. Each LH user may
 * belong to multiple workspaces and has a role (owner/admin/member/guest)
 * in each. The tool returns the user's selected workspace alongside
 * every other workspace they belong to, with the user's role and a
 * `selected` flag.
 *
 * On older LinkedHelper versions the workspace service is absent and
 * this tool returns an empty list.
 */
export function registerListWorkspaces(server: McpServer): void {
  server.tool(
    "list-workspaces",
    "List LinkedHelper workspaces the current LH user belongs to. Each workspace includes the user's role and a `selected` flag indicating the currently active workspace. Returns an empty list on LinkedHelper versions that predate workspaces (pre-2.113.x).",
    {
      ...cdpConnectionSchema,
    },
    async ({ cdpPort, cdpHost, allowRemote }) => {
      try {
        const port = await resolveLauncherPort(cdpPort, cdpHost);
        const launcher = new LauncherService(port, buildCdpOptions({ cdpHost, allowRemote }));

        try {
          await launcher.connect();
        } catch (error) {
          return mcpCatchAll(error, "Failed to connect to LinkedHelper");
        }

        try {
          const workspaces = await launcher.listWorkspaces();
          return mcpSuccess(JSON.stringify(workspaces, null, 2));
        } catch (error) {
          return mcpCatchAll(error, "Failed to list workspaces");
        } finally {
          launcher.disconnect();
        }
      } catch (error) {
        return mcpCatchAll(error, "Failed to list workspaces");
      }
    },
  );
}
