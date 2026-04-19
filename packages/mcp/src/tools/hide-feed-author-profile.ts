// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { hideFeedAuthorProfile } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#hide-feed-author-profile | hide-feed-author-profile} MCP tool. */
export function registerHideFeedAuthorProfile(server: McpServer): void {
  server.tool(
    "hide-feed-author-profile",
    "Mute a LinkedIn profile's posts in the home feed by navigating to the profile page and invoking 'Mute {Name}' from the More menu. Prefer this over `hide-feed-author` for bulk feed-hygiene workflows: feed-based tools are limited to one action per feed fetch because the feed DOM refreshes after each hide/unfollow, invalidating other indexes. Works regardless of whether the author is currently in the feed. Returns structured results: success when muted; { success: false, reason: 'mute_not_available' } for non-connections or profiles where Mute is not exposed; { success: false, reason: 'already_muted' } when the profile is already muted.",
    {
      profileUrl: z
        .string()
        .url()
        .describe(
          "LinkedIn profile URL (e.g. https://www.linkedin.com/in/{publicId}/)",
        ),
      dryRun: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "When true, open the More menu and detect mute availability but do not click Mute",
        ),
      ...cdpConnectionSchema,
    },
    async ({ profileUrl, dryRun, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await hideFeedAuthorProfile({
          profileUrl,
          cdpPort,
          cdpHost,
          allowRemote,
          dryRun,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to hide feed author via profile");
      }
    },
  );
}
