import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DatabaseClient,
  discoverAllDatabases,
  errorMessage,
  ProfileRepository,
  type ProfileSearchResult,
} from "@lhremote/core";
import { z } from "zod";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#query-profiles | query-profiles} MCP tool. */
export function registerQueryProfiles(server: McpServer): void {
  server.tool(
    "query-profiles",
    "Search for profiles in the local LinkedHelper database by name, headline, or company. Returns a list of matching profiles with pagination.",
    {
      query: z
        .string()
        .optional()
        .describe("Search name or headline (LIKE match)"),
      company: z
        .string()
        .optional()
        .describe("Filter by company name (LIKE match)"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max results (default: 20)"),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Pagination offset (default: 0)"),
    },
    async ({ query, company, limit, offset }) => {
      const databases = discoverAllDatabases();
      if (databases.size === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "No LinkedHelper databases found.",
            },
          ],
        };
      }

      // Aggregate results from all databases
      const allProfiles: ProfileSearchResult["profiles"] = [];
      let totalCount = 0;

      for (const [, dbPath] of databases) {
        const db = new DatabaseClient(dbPath);
        try {
          const repo = new ProfileRepository(db);
          const result = repo.search({
            ...(query !== undefined && { query }),
            ...(company !== undefined && { company }),
            ...(limit !== undefined && { limit }),
            ...(offset !== undefined && { offset }),
          });
          allProfiles.push(...result.profiles);
          totalCount += result.total;
        } catch (error) {
          const message = errorMessage(error);
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Failed to query profiles: ${message}`,
              },
            ],
          };
        } finally {
          db.close();
        }
      }

      const response = {
        profiles: allProfiles,
        total: totalCount,
        limit: limit ?? 20,
        offset: offset ?? 0,
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    },
  );
}
