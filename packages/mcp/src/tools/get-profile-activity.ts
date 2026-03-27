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
    "Get recent posts/activity from a LinkedIn profile. Returns structured post data with text, author info, and engagement counts. Supports cursor-based pagination.",
    {
      profile: z
        .string()
        .describe(
          "LinkedIn profile public ID or URL (e.g. johndoe or https://www.linkedin.com/in/johndoe)",
        ),
      count: z
        .number()
        .int()
        .positive()
        .optional()
        .default(10)
        .describe("Number of posts per page (default: 10)"),
      cursor: z
        .string()
        .optional()
        .describe("Cursor token from a previous call for the next page"),
      ...cdpConnectionSchema,
    },
    async ({ profile, count, cursor, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await getProfileActivity({
          profile,
          count,
          cursor,
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
