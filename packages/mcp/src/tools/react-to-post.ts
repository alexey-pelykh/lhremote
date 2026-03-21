// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reactToPost, REACTION_TYPES } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#react-to-post | react-to-post} MCP tool. */
export function registerReactToPost(server: McpServer): void {
  server.tool(
    "react-to-post",
    "React to a LinkedIn post with a specific reaction type (like, celebrate, support, love, insightful, funny). Navigates to the post and clicks the reaction button.",
    {
      postUrl: z
        .string()
        .describe(
          "LinkedIn post URL (e.g. https://www.linkedin.com/feed/update/urn:li:activity:1234567890/)",
        ),
      reactionType: z
        .enum(REACTION_TYPES as unknown as [string, ...string[]])
        .optional()
        .default("like")
        .describe(
          "Reaction type to apply (default: like). Options: like, celebrate, support, love, insightful, funny",
        ),
      ...cdpConnectionSchema,
    },
    async ({ postUrl, reactionType, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await reactToPost({
          postUrl,
          reactionType: reactionType as Parameters<typeof reactToPost>[0]["reactionType"],
          cdpPort,
          cdpHost,
          allowRemote,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to react to post");
      }
    },
  );
}
