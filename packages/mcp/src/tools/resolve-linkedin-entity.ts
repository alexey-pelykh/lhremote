// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLinkedInEntity } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#resolve-linkedin-entity | resolve-linkedin-entity} MCP tool. */
export function registerResolveLinkedInEntity(server: McpServer): void {
  server.tool(
    "resolve-linkedin-entity",
    "Resolve human-readable names (company names, locations, schools) to LinkedIn entity IDs via typeahead endpoints. Uses public endpoint first (no auth), falls back to CDP-based Voyager for SCHOOL or when public fails.",
    {
      query: z.string().describe("Search query (e.g., company name, city)"),
      entityType: z
        .enum(["COMPANY", "GEO", "SCHOOL"])
        .describe("Type of entity to resolve"),
      ...cdpConnectionSchema,
    },
    async ({ query, entityType, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await resolveLinkedInEntity({
          query,
          entityType,
          cdpPort,
          cdpHost,
          allowRemote,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to resolve entity");
      }
    },
  );
}
