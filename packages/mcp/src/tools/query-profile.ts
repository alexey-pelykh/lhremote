// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DatabaseClient,
  discoverAllDatabases,
  ProfileNotFoundError,
  ProfileRepository,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#query-profile | query-profile} MCP tool. */
export function registerQueryProfile(server: McpServer): void {
  server.tool(
    "query-profile",
    "Look up a cached LinkedIn profile from the local database without visiting LinkedIn. Returns name, positions, education, skills, and emails.",
    {
      personId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Look up by internal person ID"),
      publicId: z
        .string()
        .optional()
        .describe(
          "Look up by LinkedIn public ID (profile URL slug, e.g. jane-doe-12345)",
        ),
    },
    async ({ personId, publicId }) => {
      if ((personId == null) === (publicId == null)) {
        return mcpError(
          "Exactly one of personId or publicId must be provided.",
        );
      }

      const databases = discoverAllDatabases();
      if (databases.size === 0) {
        return mcpError("No LinkedHelper databases found.");
      }

      for (const [, dbPath] of databases) {
        const db = new DatabaseClient(dbPath);
        try {
          const repo = new ProfileRepository(db);
          const profile =
            personId != null
              ? repo.findById(personId)
              : repo.findByPublicId(publicId as string);

          return mcpSuccess(JSON.stringify(profile, null, 2));
        } catch (error) {
          if (error instanceof ProfileNotFoundError) {
            continue;
          }
          return mcpCatchAll(error, "Failed to query profile");
        } finally {
          db.close();
        }
      }

      return mcpError("Profile not found.");
    },
  );
}
