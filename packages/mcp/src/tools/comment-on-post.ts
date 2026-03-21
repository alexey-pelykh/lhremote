// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { commentOnPost } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#comment-on-post | comment-on-post} MCP tool. */
export function registerCommentOnPost(server: McpServer): void {
  server.tool(
    "comment-on-post",
    "Post a comment on a LinkedIn post. Navigate to the post, type the comment text character-by-character for human-like behaviour, and submit. Checks action budget before attempting — fails if PostComment limit is reached.",
    {
      postUrl: z
        .string()
        .describe(
          "LinkedIn post URL (e.g. https://www.linkedin.com/feed/update/urn:li:activity:1234567890/)",
        ),
      text: z
        .string()
        .describe("Comment text to post on the LinkedIn post"),
      ...cdpConnectionSchema,
    },
    async ({ postUrl, text, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await commentOnPost({ postUrl, text, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to comment on post");
      }
    },
  );
}
