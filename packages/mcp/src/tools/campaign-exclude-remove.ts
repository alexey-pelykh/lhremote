// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  DEFAULT_CDP_PORT,
  ExcludeListNotFoundError,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-exclude-remove | campaign-exclude-remove} MCP tool. */
export function registerCampaignExcludeRemove(server: McpServer): void {
  server.tool(
    "campaign-exclude-remove",
    "Remove people from a campaign or action exclude list",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to remove from the exclude list"),
      actionId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Action ID (optional). If provided, removes from the action-level exclude list. Otherwise, removes from the campaign-level exclude list.",
        ),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(DEFAULT_CDP_PORT)
        .describe("CDP port"),
      cdpHost: z
        .string()
        .optional()
        .describe("CDP host (default: 127.0.0.1)"),
      allowRemote: z
        .boolean()
        .optional()
        .describe("Allow non-loopback CDP connections"),
    },
    async ({ campaignId, personIds, actionId, cdpPort, cdpHost, allowRemote }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort, { ...(cdpHost !== undefined && { host: cdpHost }), ...(allowRemote !== undefined && { allowRemote }) });
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withDatabase(accountId, ({ db }) => {
          const campaignRepo = new CampaignRepository(db);
          const removed = campaignRepo.removeFromExcludeList(
            campaignId,
            personIds,
            actionId,
          );

          const level = actionId !== undefined ? "action" : "campaign";
          const targetLabel =
            actionId !== undefined
              ? `action ${String(actionId)} in campaign ${String(campaignId)}`
              : `campaign ${String(campaignId)}`;

          return mcpSuccess(
            JSON.stringify(
              {
                success: true,
                campaignId,
                ...(actionId !== undefined ? { actionId } : {}),
                level,
                removed,
                notInList: personIds.length - removed,
                message: `Removed ${String(removed)} person(s) from exclude list for ${targetLabel}.`,
              },
              null,
              2,
            ),
          );
        }, { readOnly: false });
      } catch (error) {
        if (error instanceof CampaignNotFoundError) {
          return mcpError(`Campaign ${String(campaignId)} not found.`);
        }
        if (error instanceof ActionNotFoundError) {
          return mcpError(`Action ${String(actionId)} not found in campaign ${String(campaignId)}.`);
        }
        if (error instanceof ExcludeListNotFoundError) {
          return mcpError(error.message);
        }
        return mcpCatchAll(error, "Failed to remove from exclude list");
      }
    },
  );
}
