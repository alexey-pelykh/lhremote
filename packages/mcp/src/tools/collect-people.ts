// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CollectionBusyError,
  CollectionError,
  collectPeople,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#collect-people | collect-people} MCP tool. */
export function registerCollectPeople(server: McpServer): void {
  server.tool(
    "collect-people",
    "Collect people from a LinkedIn page into a campaign. Detects the source type from the URL automatically. Returns immediately — poll campaign-status for progress.",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID to collect people into"),
      sourceUrl: z
        .string()
        .url()
        .describe("LinkedIn page URL to collect people from (e.g., search results, company people, group members)"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of profiles to collect"),
      maxPages: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of pages to process"),
      pageSize: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of results per page"),
      sourceType: z
        .string()
        .optional()
        .describe("Explicit source type to bypass URL detection (e.g., SearchPage, MyConnections)"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, sourceUrl, limit, maxPages, pageSize, sourceType, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await collectPeople({
          campaignId,
          sourceUrl,
          ...(limit !== undefined && { limit }),
          ...(maxPages !== undefined && { maxPages }),
          ...(pageSize !== undefined && { pageSize }),
          ...(sourceType !== undefined && { sourceType }),
          cdpPort,
          ...(cdpHost !== undefined && { cdpHost }),
          ...(allowRemote !== undefined && { allowRemote }),
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof CollectionBusyError) {
          return mcpError(`Cannot collect — instance is busy (state: ${error.runnerState})`);
        }
        if (error instanceof CollectionError) {
          return mcpError(`Collection failed: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to collect people");
      }
    },
  );
}
