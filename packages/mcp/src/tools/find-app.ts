import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorMessage, findApp } from "@lhremote/core";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#find-app | find-app} MCP tool. */
export function registerFindApp(server: McpServer): void {
  server.tool(
    "find-app",
    "Detect running LinkedHelper application instances and their CDP connection details",
    {},
    async () => {
      try {
        const apps = await findApp();

        if (apps.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No running LinkedHelper instances found",
              },
            ],
          };
        }

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(apps, null, 2) },
          ],
        };
      } catch (error) {
        const message = errorMessage(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to find LinkedHelper: ${message}`,
            },
          ],
        };
      }
    },
  );
}
