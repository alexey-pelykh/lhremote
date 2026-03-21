// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  visitProfile,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#visit-profile | visit-profile} MCP tool. */
export function registerVisitProfile(server: McpServer): void {
  server.tool(
    "visit-profile",
    "Visit a LinkedIn profile via LinkedHelper's VisitAndExtract action and return the extracted profile data. Deducts from the daily action budget.",
    {
      personId: z
        .number()
        .int()
        .positive()
        .describe("Internal person ID to visit"),
      extractCurrentOrganizations: z
        .boolean()
        .optional()
        .describe(
          "Extract current company info during profile visit",
        ),
      ...cdpConnectionSchema,
    },
    async ({ personId, extractCurrentOrganizations, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await visitProfile({ personId, extractCurrentOrganizations, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to visit profile");
      }
    },
  );
}
