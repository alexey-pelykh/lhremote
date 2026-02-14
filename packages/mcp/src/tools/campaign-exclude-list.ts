// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
  CampaignExcludeListRepository,
  ExcludeListNotFoundError,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import {
  buildCdpOptions,
  cdpConnectionSchema,
  mcpCatchAll,
  mcpError,
  mcpSuccess,
} from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-exclude-list | campaign-exclude-list} MCP tool. */
export function registerCampaignExcludeList(server: McpServer): void {
  server.tool(
    "campaign-exclude-list",
    "View the exclude list for a campaign or a specific action within a campaign",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      actionId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Action ID (optional). If provided, shows the action-level exclude list. Otherwise, shows the campaign-level exclude list.",
        ),
      ...cdpConnectionSchema,
    },
    async ({ campaignId, actionId, cdpPort, cdpHost, allowRemote }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort, buildCdpOptions({ cdpHost, allowRemote }));
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withDatabase(accountId, ({ db }) => {
          const excludeListRepo = new CampaignExcludeListRepository(db);
          const entries = excludeListRepo.getExcludeList(campaignId, actionId);

          const level = actionId !== undefined ? "action" : "campaign";
          const targetLabel =
            actionId !== undefined
              ? `action ${String(actionId)} in campaign ${String(campaignId)}`
              : `campaign ${String(campaignId)}`;

          return mcpSuccess(
            JSON.stringify(
              {
                campaignId,
                ...(actionId !== undefined ? { actionId } : {}),
                level,
                count: entries.length,
                personIds: entries.map((e) => e.personId),
                message: `Exclude list for ${targetLabel}: ${String(entries.length)} person(s).`,
              },
              null,
              2,
            ),
          );
        });
      } catch (error) {
        if (error instanceof ActionNotFoundError) {
          return mcpError(`Action ${String(actionId)} not found in campaign ${String(campaignId)}.`);
        }
        if (error instanceof ExcludeListNotFoundError) {
          return mcpError(error.message);
        }
        return mcpCatchAll(error, "Failed to get exclude list");
      }
    },
  );
}
