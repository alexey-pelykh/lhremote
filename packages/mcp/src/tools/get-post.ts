// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPost } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#get-post | get-post} MCP tool. */
export function registerGetPost(server: McpServer): void {
  server.tool(
    "get-post",
    "Get detailed data for a single LinkedIn post including its comment thread. Returns post content, author info, engagement counts, and paginated comments.",
    {
      postUrl: z
        .string()
        .describe(
          "LinkedIn post URL or URN (e.g. https://www.linkedin.com/feed/update/urn:li:activity:1234567890/ or urn:li:activity:1234567890)",
        ),
      commentStart: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .default(0)
        .describe("Comment pagination offset (default: 0)"),
      commentCount: z
        .number()
        .int()
        .positive()
        .optional()
        .default(10)
        .describe("Number of comments per page (default: 10)"),
      ...cdpConnectionSchema,
    },
    async ({ postUrl, commentStart, commentCount, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await getPost({
          postUrl,
          commentStart,
          commentCount,
          cdpPort,
          cdpHost,
          allowRemote,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to get post");
      }
    },
  );
}
