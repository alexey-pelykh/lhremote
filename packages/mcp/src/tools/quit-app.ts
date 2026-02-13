// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppService, DEFAULT_CDP_PORT, errorMessage } from "@lhremote/core";
import { z } from "zod";

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
        const message = errorMessage(error);
        return {
          isError: true,
          content: [
            { type: "text", text: `Failed to quit LinkedHelper: ${message}` },
          ],
        };
      }

      return {
        content: [{ type: "text", text: "LinkedHelper quit successfully" }],
      };
    },
  );
}
