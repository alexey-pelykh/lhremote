import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  errorMessage,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";
import { z } from "zod";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#stop-instance | stop-instance} MCP tool. */
export function registerStopInstance(server: McpServer): void {
  server.tool(
    "stop-instance",
    "Stop a running LinkedHelper instance",
    {
      accountId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Account ID (omit to stop the only running instance)",
        ),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ accountId, cdpPort }) => {
      const launcher = new LauncherService(cdpPort);

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

        await launcher.stopInstance(resolvedId);

        return {
          content: [
            {
              type: "text" as const,
              text: `Instance stopped for account ${String(resolvedId)}`,
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
              text: `Failed to stop instance: ${message}`,
            },
          ],
        };
      } finally {
        launcher.disconnect();
      }
    },
  );
}
