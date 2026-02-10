import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppService, errorMessage } from "@lhremote/core";
import { z } from "zod";

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
        .default(9222)
        .describe("CDP port (default: 9222)"),
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
