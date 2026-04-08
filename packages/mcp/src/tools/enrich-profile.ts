// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enrichProfile } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

const enrichmentCategorySchema = z.object({
  shouldEnrich: z.boolean(),
  actualDate: z.number().int().nonnegative().optional(),
  types: z.array(z.string()).optional(),
});

/** Register the {@link https://github.com/alexey-pelykh/lhremote#enrich-profile | enrich-profile} MCP tool. */
export function registerEnrichProfile(server: McpServer): void {
  server.tool(
    "enrich-profile",
    "Enrich a LinkedIn profile by extracting additional data (emails, phones, socials, company info) via an ephemeral campaign. Accepts a person ID or LinkedIn profile URL. Deducts from the daily action budget.",
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
      profileInfo: enrichmentCategorySchema
        .optional()
        .describe("Enrich profile info"),
      phones: enrichmentCategorySchema
        .optional()
        .describe("Enrich phone numbers"),
      emails: enrichmentCategorySchema
        .optional()
        .describe("Enrich email addresses"),
      socials: enrichmentCategorySchema
        .optional()
        .describe("Enrich social profiles"),
      companies: enrichmentCategorySchema
        .optional()
        .describe("Enrich company data"),
      keepCampaign: z
        .boolean()
        .optional()
        .describe("Archive the ephemeral campaign instead of deleting it"),
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum time to wait for action completion in milliseconds (default: 5 min)"),
      ...cdpConnectionSchema,
    },
    async ({ personId, url, profileInfo, phones, emails, socials, companies, keepCampaign, timeout, cdpPort, cdpHost, allowRemote, accountId }) => {
      if ((personId == null) === (url == null)) {
        return mcpError("Exactly one of personId or url must be provided.");
      }

      try {
        const result = await enrichProfile({
          personId, url, profileInfo, phones, emails, socials, companies,
          keepCampaign, timeout, cdpPort, cdpHost, allowRemote, accountId,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to enrich profile");
      }
    },
  );
}
