import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorMessage, LauncherService, LinkedHelperNotRunningError } from "@lhremote/core";
import { z } from "zod";

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
        .default(9222)
        .describe("CDP port (default: 9222)"),
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
