import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getActionTypeCatalog, getActionTypeInfo } from "@lhremote/core";
import { z } from "zod";

export function registerDescribeActions(server: McpServer): void {
  server.tool(
    "describe-actions",
    "List available LinkedHelper action types with descriptions and configuration schemas. Use this to discover what actions can be included in campaigns.",
    {
      category: z
        .enum(["people", "messaging", "engagement", "crm", "workflow", "all"])
        .optional()
        .default("all")
        .describe("Filter by action category"),
      actionType: z
        .string()
        .optional()
        .describe("Get detailed info for a specific action type"),
    },
    async ({ category, actionType }) => {
      if (actionType !== undefined) {
        const info = getActionTypeInfo(actionType);
        if (info === undefined) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Unknown action type: ${actionType}`,
              },
            ],
          };
        }
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(info, null, 2) },
          ],
        };
      }

      const catalog = getActionTypeCatalog(
        category === "all" ? undefined : category,
      );

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(catalog, null, 2) },
        ],
      };
    },
  );
}
