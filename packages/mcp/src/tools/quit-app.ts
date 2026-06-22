// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppService, DEFAULT_CDP_PORT, resolveLauncherPort } from "@insoftex/lhremote-core";
import { z } from "zod";
import { mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/insoftex-company/insoftex-lhremote#quit-app | quit-app} MCP tool. */
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
        .describe("CDP port (auto-discovered from the launcher when omitted)"),
    },
    async ({ cdpPort }) => {
      let port = cdpPort;
      try {
        port ??= await resolveLauncherPort();
      } catch {
        port = DEFAULT_CDP_PORT;
      }

      const app = new AppService(port);

      try {
        await app.quit();
      } catch (error) {
        return mcpCatchAll(error, "Failed to quit LinkedHelper");
      }

      return mcpSuccess("LinkedHelper quit successfully");
    },
  );
}
