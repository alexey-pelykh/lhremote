// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findApp } from "@lhremote/core";
import { mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#find-app | find-app} MCP tool. */
export function registerFindApp(server: McpServer): void {
  server.tool(
    "find-app",
    "Detect running LinkedHelper application instances and their CDP connection details",
    {},
    async () => {
      try {
        const apps = await findApp();

        if (apps.length === 0) {
          return mcpSuccess("No running LinkedHelper instances found");
        }

        return mcpSuccess(JSON.stringify(apps, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to find LinkedHelper");
      }
    },
  );
}
