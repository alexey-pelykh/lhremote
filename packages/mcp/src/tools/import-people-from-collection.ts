// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignExecutionError,
  importPeopleFromCollection,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#import-people-from-collection | import-people-from-collection} MCP tool. */
export function registerImportPeopleFromCollection(server: McpServer): void {
  server.tool(
    "import-people-from-collection",
    "Import all people from a LinkedHelper collection (List) into a campaign action's target list. Reads LinkedIn profile URLs from the collection and feeds them into the campaign. Large sets are automatically chunked.",
    {
      collectionId: z
        .number()
        .int()
        .positive()
        .describe("Collection ID to import people from"),
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID to import people into"),
      ...cdpConnectionSchema,
    },
    async ({ collectionId, campaignId, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await importPeopleFromCollection({ collectionId, campaignId, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to import people: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to import people from collection");
      }
    },
  );
}
