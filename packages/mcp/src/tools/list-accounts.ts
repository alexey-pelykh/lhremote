// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DEFAULT_CDP_PORT,
  errorMessage,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";
import { z } from "zod";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#list-accounts | list-accounts} MCP tool. */
export function registerListAccounts(server: McpServer): void {
  server.tool(
    "list-accounts",
    "List available LinkedHelper accounts",
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
      const launcher = new LauncherService(cdpPort);

      try {
        await launcher.connect();
      } catch (error) {
        if (error instanceof LinkedHelperNotRunningError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "LinkedHelper is not running. Use launch-app first.",
              },
            ],
          };
        }
        const message = errorMessage(error);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to connect to LinkedHelper: ${message}`,
            },
          ],
        };
      }

      try {
        const accounts = await launcher.listAccounts();
        return {
          content: [
            { type: "text", text: JSON.stringify(accounts, null, 2) },
          ],
        };
      } catch (error) {
        const message = errorMessage(error);
        return {
          isError: true,
          content: [
            { type: "text", text: `Failed to list accounts: ${message}` },
          ],
        };
      } finally {
        launcher.disconnect();
      }
    },
  );
}
