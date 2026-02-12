import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkStatus, errorMessage } from "@lhremote/core";
import { z } from "zod";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#check-status | check-status} MCP tool. */
export function registerCheckStatus(server: McpServer): void {
  server.tool(
    "check-status",
    "Check LinkedHelper connection status, running instances, and database health",
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
      try {
        const report = await checkStatus(cdpPort);

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(report, null, 2) },
          ],
        };
      } catch (error) {
        const message = errorMessage(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to check status: ${message}`,
            },
          ],
        };
      }
    },
  );
}
