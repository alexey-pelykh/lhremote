// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { endorseSkills } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#endorse-skills | endorse-skills} MCP tool. */
export function registerEndorseSkills(server: McpServer): void {
  server.tool(
    "endorse-skills",
    "Endorse skills on a LinkedIn profile via an ephemeral campaign. Accepts a person ID or LinkedIn profile URL. Deducts from the daily action budget.",
    {
      personId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Internal person ID"),
      url: z
        .string()
        .optional()
        .describe("LinkedIn profile URL (e.g. https://www.linkedin.com/in/jane-doe)"),
      skillNames: z
        .array(z.string())
        .optional()
        .describe("Specific skill names to endorse (mutually exclusive with limit)"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max number of skills to endorse (mutually exclusive with skillNames)"),
      skipIfNotEndorsable: z
        .boolean()
        .optional()
        .describe("Skip if person has no endorsable skills (default: true)"),
      keepCampaign: z
        .boolean()
        .optional()
        .describe("Archive the ephemeral campaign instead of deleting it"),
      ...cdpConnectionSchema,
    },
    async ({ personId, url, skillNames, limit, skipIfNotEndorsable, keepCampaign, cdpPort, cdpHost, allowRemote, accountId }) => {
      if ((personId == null) === (url == null)) {
        return mcpError("Exactly one of personId or url must be provided.");
      }

      try {
        const result = await endorseSkills({
          personId, url, skillNames, limit, skipIfNotEndorsable, keepCampaign, cdpPort, cdpHost, allowRemote, accountId,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to endorse skills");
      }
    },
  );
}
