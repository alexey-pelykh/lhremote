import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  ExcludeListNotFoundError,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-exclude-add | campaign-exclude-add} MCP tool. */
export function registerCampaignExcludeAdd(server: McpServer): void {
  server.tool(
    "campaign-exclude-add",
    "Add people to a campaign or action exclude list",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to add to the exclude list"),
      actionId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Action ID (optional). If provided, adds to the action-level exclude list. Otherwise, adds to the campaign-level exclude list.",
        ),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ campaignId, personIds, actionId, cdpPort }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort);
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withDatabase(accountId, ({ db }) => {
          const campaignRepo = new CampaignRepository(db);
          const added = campaignRepo.addToExcludeList(
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
                added,
                alreadyExcluded: personIds.length - added,
                message: `Added ${String(added)} person(s) to exclude list for ${targetLabel}.`,
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
        return mcpCatchAll(error, "Failed to add to exclude list");
      }
    },
  );
}
