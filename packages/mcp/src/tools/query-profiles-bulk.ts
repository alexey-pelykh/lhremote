// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Profile } from "@lhremote/core";
import {
  DatabaseClient,
  discoverAllDatabases,
  ProfileRepository,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#query-profiles-bulk | query-profiles-bulk} MCP tool. */
export function registerQueryProfilesBulk(server: McpServer): void {
  server.tool(
    "query-profiles-bulk",
    "Look up multiple cached LinkedIn profiles from the local database in a single call. Returns an array of profile records (null for IDs not found).",
    {
      personIds: z
        .array(z.number().int().positive())
        .optional()
        .describe("Look up by internal person IDs"),
      publicIds: z
        .array(z.string())
        .optional()
        .describe(
          "Look up by LinkedIn public IDs (profile URL slugs, e.g. jane-doe-12345)",
        ),
      includePositions: z
        .boolean()
        .optional()
        .describe(
          "When true, include full position history (career history) in each profile",
        ),
    },
    async ({ personIds, publicIds, includePositions }) => {
      const hasPersonIds = personIds != null && personIds.length > 0;
      const hasPublicIds = publicIds != null && publicIds.length > 0;

      if (!hasPersonIds && !hasPublicIds) {
        return mcpError(
          "At least one of personIds or publicIds must be provided with at least one element.",
        );
      }

      const databases = discoverAllDatabases();
      if (databases.size === 0) {
        return mcpError("No LinkedHelper databases found.");
      }

      const findOptions = { includePositions: includePositions === true };

      // Track results by key for deduplication across databases
      const byPersonId = new Map<number, Profile>();
      const byPublicId = new Map<string, Profile>();

      for (const [, dbPath] of databases) {
        const db = new DatabaseClient(dbPath);
        try {
          const repo = new ProfileRepository(db);

          if (hasPersonIds) {
            const remaining = personIds.filter((id) => !byPersonId.has(id));
            if (remaining.length > 0) {
              const results = repo.findByIds(remaining, findOptions);
              for (const [i, id] of remaining.entries()) {
                const profile = results[i];
                if (profile != null) {
                  byPersonId.set(id, profile);
                }
              }
            }
          }

          if (hasPublicIds) {
            const remaining = publicIds.filter((s) => !byPublicId.has(s));
            if (remaining.length > 0) {
              const results = repo.findByPublicIds(remaining, findOptions);
              for (const [i, slug] of remaining.entries()) {
                const profile = results[i];
                if (profile != null) {
                  byPublicId.set(slug, profile);
                }
              }
            }
          }
        } catch (error) {
          return mcpCatchAll(error, "Failed to query profiles");
        } finally {
          db.close();
        }
      }

      const result: {
        byPersonId?: (Profile | null)[];
        byPublicId?: (Profile | null)[];
      } = {};

      if (hasPersonIds) {
        result.byPersonId = personIds.map((id) => byPersonId.get(id) ?? null);
      }
      if (hasPublicIds) {
        result.byPublicId = publicIds.map((s) => byPublicId.get(s) ?? null);
      }

      return mcpSuccess(JSON.stringify(result, null, 2));
    },
  );
}
