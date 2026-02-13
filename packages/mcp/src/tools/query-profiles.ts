// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DatabaseClient,
  discoverAllDatabases,
  ProfileRepository,
  type ProfileSearchResult,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

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
        return mcpError("No LinkedHelper databases found.");
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
          });
          allProfiles.push(...result.profiles);
          totalCount += result.total;
        } catch (error) {
          return mcpCatchAll(error, "Failed to query profiles");
        } finally {
          db.close();
        }
      }

      const effectiveOffset = offset ?? 0;
      const effectiveLimit = limit ?? 20;
      const paginatedProfiles = allProfiles.slice(
        effectiveOffset,
        effectiveOffset + effectiveLimit,
      );

      const response = {
        profiles: paginatedProfiles,
        total: totalCount,
        limit: effectiveLimit,
        offset: effectiveOffset,
      };

      return mcpSuccess(JSON.stringify(response, null, 2));
    },
  );
}
