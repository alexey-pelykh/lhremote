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
    "List people who engaged with a LinkedIn post (reacted, etc.) with their profile info and engagement type. Supports pagination. " +
      "The `shortfall` field is null when no reaction count the page rendered contradicted what was collected — the absence of a contradiction, which neither guarantees completeness nor implies a check ran: a collection that reached what it asked for is not checked at all, and where the page rendered no readable count there is nothing to contradict. " +
      "Otherwise it reports how many rows were collected, how many were asked for, the reaction count the page itself rendered, and why collection stopped. " +
      "`paging.total` is the page's own reaction count where that was readable, and falls back to the number of rows COLLECTED where it was not — the pre-pagination count, not the length of the returned slice, so with `start` > 0 it can exceed the rows you got back. Either way it is not an independent answer to whether more exist.",
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
    async ({ postUrl, start, count, cdpPort, cdpHost, allowRemote, accountId }) => {
      try {
        const result = await getPostEngagers({
          postUrl,
          start,
          count,
          cdpPort,
          cdpHost,
          allowRemote,
          accountId,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to get post engagers");
      }
    },
  );
}
