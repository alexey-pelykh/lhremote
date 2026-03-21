// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  visitProfile,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#visit-profile | visit-profile} MCP tool. */
export function registerVisitProfile(server: McpServer): void {
  server.tool(
    "visit-profile",
    "Visit a LinkedIn profile via LinkedHelper's VisitAndExtract action and return the extracted profile data. Accepts either a person ID or a LinkedIn profile URL. Deducts from the daily action budget.",
    {
      personId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Internal person ID to visit"),
      url: z
        .string()
        .optional()
        .describe(
          "LinkedIn profile URL (e.g. https://www.linkedin.com/in/jane-doe-123). The person must already exist in the database.",
        ),
      extractCurrentOrganizations: z
        .boolean()
        .optional()
        .describe(
          "Extract current company info during profile visit",
        ),
      ...cdpConnectionSchema,
    },
    async ({ personId, url, extractCurrentOrganizations, cdpPort, cdpHost, allowRemote }) => {
      if ((personId == null) === (url == null)) {
        return mcpError(
          "Exactly one of personId or url must be provided.",
        );
      }

      try {
        const result = await visitProfile({ personId, url, extractCurrentOrganizations, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to visit profile");
      }
    },
  );
}
