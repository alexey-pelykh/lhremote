// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reactToComment, REACTION_TYPES } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#react-to-comment | react-to-comment} MCP tool. */
export function registerReactToComment(server: McpServer): void {
  server.tool(
    "react-to-comment",
    "React to a specific LinkedIn comment with a specific reaction type (like, celebrate, support, love, insightful, funny). Navigates to the parent post, locates the comment by URN, and clicks the reaction button. Mirrors react-to-post semantics scoped to one comment. With dryRun, validates the popup opens but skips the click.",
    {
      postUrl: z
        .string()
        .describe(
          "LinkedIn post URL containing the target comment (e.g. https://www.linkedin.com/feed/update/urn:li:activity:1234567890/)",
        ),
      commentUrn: z
        .string()
        .describe(
          "Target comment URN as returned by get-post (e.g. urn:li:comment:(activity:1234567890,9876543210))",
        ),
      reactionType: z
        .enum(REACTION_TYPES as unknown as [string, ...string[]])
        .optional()
        .default("like")
        .describe(
          "Reaction type to apply (default: like). Options: like, celebrate, support, love, insightful, funny",
        ),
      dryRun: z.boolean().optional().default(false).describe("When true, detect current reaction state without clicking"),
      ...cdpConnectionSchema,
    },
    async ({ postUrl, commentUrn, reactionType, dryRun, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await reactToComment({
          postUrl,
          commentUrn,
          reactionType: reactionType as Parameters<typeof reactToComment>[0]["reactionType"],
          cdpPort,
          cdpHost,
          allowRemote,
          dryRun,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to react to comment");
      }
    },
  );
}
