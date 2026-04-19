// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { unfollowProfile } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#unfollow-profile | unfollow-profile} MCP tool. */
export function registerUnfollowProfile(server: McpServer): void {
  server.tool(
    "unfollow-profile",
    "Unfollow a LinkedIn profile by navigating to its profile page and clicking the Following → Unfollow toggle. Prefer this over `unfollow-from-feed` for bulk feed-hygiene workflows: feed-based tools are limited to one action per feed fetch because the feed DOM refreshes after each hide/unfollow, invalidating other indexes. Works regardless of whether the author is currently in the home feed. Returns the detected prior follow state so bulk workflows can distinguish actual unfollows from no-op calls on already-unfollowed or private profiles.",
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
          "When true, detect the follow state but do not click Unfollow (dialog is opened and dismissed)",
        ),
      ...cdpConnectionSchema,
    },
    async ({ profileUrl, dryRun, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await unfollowProfile({
          profileUrl,
          cdpPort,
          cdpHost,
          allowRemote,
          dryRun,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to unfollow profile");
      }
    },
  );
}
