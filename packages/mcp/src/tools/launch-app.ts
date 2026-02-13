// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppLaunchError, AppNotFoundError, AppService } from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#launch-app | launch-app} MCP tool. */
export function registerLaunchApp(server: McpServer): void {
  server.tool(
    "launch-app",
    "Launch the LinkedHelper application with remote debugging enabled",
    {
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("CDP port (default: auto-select)"),
    },
    async ({ cdpPort }) => {
      const app = new AppService(cdpPort);

      try {
        await app.launch();
      } catch (error) {
        if (
          error instanceof AppNotFoundError ||
          error instanceof AppLaunchError
        ) {
          return mcpError(error.message);
        }
        return mcpCatchAll(error, "Failed to launch LinkedHelper");
      }

      return mcpSuccess(
        `LinkedHelper launched on CDP port ${String(app.cdpPort)}`,
      );
    },
  );
}
