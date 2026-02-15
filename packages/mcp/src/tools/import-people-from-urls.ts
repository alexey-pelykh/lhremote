// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignExecutionError,
  importPeopleFromUrls,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#import-people-from-urls | import-people-from-urls} MCP tool. */
export function registerImportPeopleFromUrls(server: McpServer): void {
  server.tool(
    "import-people-from-urls",
    "Import LinkedIn profile URLs into a campaign action's target list. Idempotent — re-importing an already-targeted person is a no-op.",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID to import people into"),
      linkedInUrls: z
        .array(z.string().url())
        .nonempty()
        .describe("LinkedIn profile URLs to import"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, linkedInUrls, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await importPeopleFromUrls({ campaignId, linkedInUrls, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to import people: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to import people");
      }
    },
  );
}
