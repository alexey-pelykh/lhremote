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
      parentCommentUrn: z
        .string()
        .optional()
        .describe(
          "When provided, posts the comment as a reply to this specific comment " +
            "instead of as a top-level comment. Use the commentUrn value from get-post output " +
            '(e.g. "urn:li:comment:(activity:1234567890,9876543210)")',
        ),
      mentions: z
        .array(
          z.object({
            name: z
              .string()
              .describe("Display name to @mention (must appear as @Name in text)"),
          }),
        )
        .optional()
        .describe(
          "People to @mention in the comment. Each entry's name must appear as a " +
            'literal @Name in the text (e.g. text "@John Doe hello" with mentions [{name: "John Doe"}]). ' +
            "During typing, each @Name triggers LinkedIn's mention autocomplete.",
        ),
      dryRun: z
        .boolean()
        .optional()
        .default(false)
        .describe("When true, prepare the comment but do not click submit"),
      ...cdpConnectionSchema,
    },
    async ({ postUrl, text, parentCommentUrn, mentions, dryRun, cdpPort, cdpHost, allowRemote, accountId }) => {
      try {
        const result = await commentOnPost({ postUrl, text, parentCommentUrn, mentions, dryRun, cdpPort, cdpHost, allowRemote, accountId });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to comment on post");
      }
    },
  );
}
