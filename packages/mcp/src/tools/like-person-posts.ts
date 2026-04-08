// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { likePersonPosts } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#like-person-posts | like-person-posts} MCP tool. */
export function registerLikePersonPosts(server: McpServer): void {
  server.tool(
    "like-person-posts",
    "Like and optionally comment on posts and articles by a LinkedIn profile via an ephemeral campaign. Accepts a person ID or LinkedIn profile URL. Deducts from the daily action budget.",
    {
      personId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Internal person ID"),
      url: z
        .string()
        .optional()
        .describe("LinkedIn profile URL (e.g. https://www.linkedin.com/in/jane-doe)"),
      numberOfArticles: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Number of articles to like"),
      numberOfPosts: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Number of posts to like"),
      maxAgeOfArticles: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Maximum age of articles in days"),
      maxAgeOfPosts: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Maximum age of posts in days"),
      shouldAddComment: z
        .boolean()
        .optional()
        .describe("Also add a comment to liked posts/articles"),
      messageTemplate: z
        .string()
        .optional()
        .describe("Comment text template as JSON string (required when shouldAddComment is true)"),
      skipIfNotLiked: z
        .boolean()
        .optional()
        .describe("Skip if nothing was liked (default: true)"),
      keepCampaign: z
        .boolean()
        .optional()
        .describe("Archive the ephemeral campaign instead of deleting it"),
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum time to wait for action completion in milliseconds (default: 5 min)"),
      ...cdpConnectionSchema,
    },
    async ({ personId, url, numberOfArticles, numberOfPosts, maxAgeOfArticles, maxAgeOfPosts, shouldAddComment, messageTemplate, skipIfNotLiked, keepCampaign, timeout, cdpPort, cdpHost, allowRemote, accountId }) => {
      if ((personId == null) === (url == null)) {
        return mcpError("Exactly one of personId or url must be provided.");
      }

      let parsedMessageTemplate: Record<string, unknown> | undefined;
      if (messageTemplate) {
        try {
          parsedMessageTemplate = JSON.parse(messageTemplate) as Record<string, unknown>;
        } catch {
          return mcpError("Invalid JSON in messageTemplate.");
        }
      }

      try {
        const result = await likePersonPosts({
          personId, url, numberOfArticles, numberOfPosts, maxAgeOfArticles, maxAgeOfPosts,
          shouldAddComment, messageTemplate: parsedMessageTemplate, skipIfNotLiked,
          keepCampaign, timeout, cdpPort, cdpHost, allowRemote, accountId,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to like person posts");
      }
    },
  );
}
