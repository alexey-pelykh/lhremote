// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CollectionBusyError,
  CollectionError,
  collectPeople,
  withLoggedInStateRetryAtPort,
} from "@insoftex/lhremote-core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the campaign-import-from-source-url MCP tool. */
export function registerCampaignImportFromSourceUrl(server: McpServer): void {
  server.tool(
    "campaign-import-from-source-url",
    "Import people into a campaign from a LinkedIn source URL such as people search results, company people, group members, or my connections",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID to import people into"),
      sourceUrl: z
        .string()
        .url()
        .describe("LinkedIn source URL, e.g. people search results, company people, group members, or my connections"),
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
        .describe("Explicit source type to bypass URL detection, e.g. SearchPage or MyConnections"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, sourceUrl, limit, maxPages, pageSize, sourceType, cdpPort, cdpHost, allowRemote, accountId }) => {
      try {
        const result = await withLoggedInStateRetryAtPort(
          cdpPort,
          cdpHost ?? "127.0.0.1",
          allowRemote ?? false,
          () =>
            collectPeople({
              campaignId,
              sourceUrl,
              ...(limit !== undefined && { limit }),
              ...(maxPages !== undefined && { maxPages }),
              ...(pageSize !== undefined && { pageSize }),
              ...(sourceType !== undefined && { sourceType }),
              cdpPort,
              ...(cdpHost !== undefined && { cdpHost }),
              ...(allowRemote !== undefined && { allowRemote }),
              ...(accountId !== undefined && { accountId }),
            }),
        );
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof CollectionBusyError) {
          return mcpError(`Cannot import from source URL - instance is busy (state: ${error.runnerState})`);
        }
        if (error instanceof CollectionError) {
          return mcpError(`Source URL import failed: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to import from source URL");
      }
    },
  );
}
