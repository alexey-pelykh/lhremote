// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignStatisticsRepository,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import {
  buildCdpOptions,
  cdpConnectionSchema,
  mcpCatchAll,
  mcpSuccess,
} from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-retry | campaign-retry} MCP tool. */
export function registerCampaignRetry(server: McpServer): void {
  server.tool(
    "campaign-retry",
    "Reset specified people for re-run in a campaign (three-table reset without starting the campaign)",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to reset for retry"),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, personIds, cdpPort, cdpHost, allowRemote }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort, buildCdpOptions({ cdpHost, allowRemote }));
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withDatabase(accountId, ({ db }) => {
          const statisticsRepo = new CampaignStatisticsRepository(db);
          statisticsRepo.resetForRerun(campaignId, personIds);

          return mcpSuccess(
            JSON.stringify(
              {
                success: true,
                campaignId,
                personsReset: personIds.length,
                message:
                  "Persons reset for retry. Use campaign-start to run the campaign.",
              },
              null,
              2,
            ),
          );
        }, { readOnly: false });
      } catch (error) {
        return mcpCatchAll(error, "Failed to reset persons for retry");
      }
    },
  );
}
