// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppService, DEFAULT_CDP_PORT } from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#quit-app | quit-app} MCP tool. */
export function registerQuitApp(server: McpServer): void {
  server.tool(
    "quit-app",
    "Quit the LinkedHelper application",
    {
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(DEFAULT_CDP_PORT)
        .describe("CDP port"),
    },
    async ({ cdpPort }) => {
      const app = new AppService(cdpPort);

      try {
        await app.quit();
      } catch (error) {
        return mcpCatchAll(error, "Failed to quit LinkedHelper");
      }

      return mcpSuccess("LinkedHelper quit successfully");
    },
  );
}
