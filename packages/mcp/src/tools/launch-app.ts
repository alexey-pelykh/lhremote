import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppLaunchError, AppNotFoundError, AppService, errorMessage } from "@lhremote/core";
import { z } from "zod";

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
          return {
            isError: true,
            content: [{ type: "text", text: error.message }],
          };
        }
        const message = errorMessage(error);
        return {
          isError: true,
          content: [
            { type: "text", text: `Failed to launch LinkedHelper: ${message}` },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `LinkedHelper launched on CDP port ${String(app.cdpPort)}`,
          },
        ],
      };
    },
  );
}
