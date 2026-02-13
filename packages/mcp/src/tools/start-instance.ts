// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  DEFAULT_CDP_PORT,
  errorMessage,
  LauncherService,
  LinkedHelperNotRunningError,
  startInstanceWithRecovery,
} from "@lhremote/core";
import { z } from "zod";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#start-instance | start-instance} MCP tool. */
export function registerStartInstance(server: McpServer): void {
  server.tool(
    "start-instance",
    "Start a LinkedHelper instance for a LinkedIn account. Required before campaign or query operations.",
    {
      accountId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Account ID (omit to auto-select if single account)",
        ),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(DEFAULT_CDP_PORT)
        .describe("CDP port"),
      cdpHost: z
        .string()
        .optional()
        .describe("CDP host (default: 127.0.0.1)"),
      allowRemote: z
        .boolean()
        .optional()
        .describe("Allow non-loopback CDP connections"),
    },
    async ({ accountId, cdpPort, cdpHost, allowRemote }) => {
      const launcher = new LauncherService(cdpPort, { ...(cdpHost !== undefined && { host: cdpHost }), ...(allowRemote !== undefined && { allowRemote }) });

      try {
        await launcher.connect();
      } catch (error) {
        if (error instanceof LinkedHelperNotRunningError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
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
              type: "text" as const,
              text: `Failed to connect to LinkedHelper: ${message}`,
            },
          ],
        };
      }

      try {
        let resolvedId = accountId;

        if (resolvedId === undefined) {
          const accounts = await launcher.listAccounts();
          if (accounts.length === 0) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: "No accounts found.",
                },
              ],
            };
          }
          if (accounts.length > 1) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: "Multiple accounts found. Specify accountId. Use list-accounts to see available accounts.",
                },
              ],
            };
          }
          resolvedId = (accounts[0] as Account).id;
        }

        const outcome = await startInstanceWithRecovery(
          launcher,
          resolvedId,
          cdpPort,
        );

        if (outcome.status === "timeout") {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Instance started but failed to initialize within timeout.`,
              },
            ],
          };
        }

        const verb =
          outcome.status === "already_running"
            ? "already running"
            : "started";

        return {
          content: [
            {
              type: "text" as const,
              text: `Instance ${verb} for account ${String(resolvedId)} on CDP port ${String(outcome.port)}`,
            },
          ],
        };
      } catch (error) {
        const message = errorMessage(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to start instance: ${message}`,
            },
          ],
        };
      } finally {
        launcher.disconnect();
      }
    },
  );
}
