// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPostEngagers } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#get-post-engagers | get-post-engagers} MCP tool. */
export function registerGetPostEngagers(server: McpServer): void {
  server.tool(
    "get-post-engagers",
    "List people who engaged with a LinkedIn post (reacted, etc.) with their profile info and engagement type. Supports pagination.",
    {
      postUrl: z
        .string()
        .describe(
          "LinkedIn post URL or URN (e.g. https://www.linkedin.com/feed/update/urn:li:activity:1234567890/ or urn:li:activity:1234567890)",
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
        .describe("Number of engagers per page (default: 20)"),
      ...cdpConnectionSchema,
    },
    async ({ postUrl, start, count, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await getPostEngagers({
          postUrl,
          start,
          count,
          cdpPort,
          cdpHost,
          allowRemote,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to get post engagers");
      }
    },
  );
}
