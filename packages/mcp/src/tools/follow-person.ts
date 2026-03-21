// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { followPerson } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#follow-person | follow-person} MCP tool. */
export function registerFollowPerson(server: McpServer): void {
  server.tool(
    "follow-person",
    "Follow or unfollow a LinkedIn profile via an ephemeral campaign. Accepts a person ID or LinkedIn profile URL. Deducts from the daily action budget.",
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
      mode: z
        .enum(["follow", "unfollow"])
        .optional()
        .describe('Follow or unfollow (default: "follow")'),
      skipIfUnfollowable: z
        .boolean()
        .optional()
        .describe("Skip if person cannot be unfollowed (default: true)"),
      keepCampaign: z
        .boolean()
        .optional()
        .describe("Archive the ephemeral campaign instead of deleting it"),
      ...cdpConnectionSchema,
    },
    async ({ personId, url, mode, skipIfUnfollowable, keepCampaign, cdpPort, cdpHost, allowRemote }) => {
      if ((personId == null) === (url == null)) {
        return mcpError("Exactly one of personId or url must be provided.");
      }

      try {
        const result = await followPerson({
          personId, url, mode, skipIfUnfollowable, keepCampaign, cdpPort, cdpHost, allowRemote,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to follow person");
      }
    },
  );
}
