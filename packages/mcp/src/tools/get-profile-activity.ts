// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProfileActivity } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#get-profile-activity | get-profile-activity} MCP tool. */
export function registerGetProfileActivity(server: McpServer): void {
  server.tool(
    "get-profile-activity",
    "Get recent posts/activity from a LinkedIn profile. Returns structured post data with text, author info, and engagement counts. Supports pagination.",
    {
      profile: z
        .string()
        .describe(
          "LinkedIn profile public ID or URL (e.g. johndoe or https://www.linkedin.com/in/johndoe)",
        ),
      start: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .default(0)
        .describe("Pagination offset (default: 0)"),
      count: z
        .number()
        .int()
        .positive()
        .optional()
        .default(20)
        .describe("Number of posts per page (default: 20)"),
      ...cdpConnectionSchema,
    },
    async ({ profile, start, count, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await getProfileActivity({
          profile,
          start,
          count,
          cdpPort,
          cdpHost,
          allowRemote,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to get profile activity");
      }
    },
  );
}
