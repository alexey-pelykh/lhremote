import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  NoNextActionError,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-move-next | campaign-move-next} MCP tool. */
export function registerCampaignMoveNext(server: McpServer): void {
  server.tool(
    "campaign-move-next",
    "Move people from one action to the next action in a campaign chain (without executing the current action)",
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
        .describe("Action ID to move people from"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to advance to the next action"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ campaignId, actionId, personIds, cdpPort }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort);
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withDatabase(accountId, ({ db }) => {
          const campaignRepo = new CampaignRepository(db);
          const { nextActionId } = campaignRepo.moveToNextAction(
            campaignId,
            actionId,
            personIds,
          );

          return mcpSuccess(
            JSON.stringify(
              {
                success: true,
                campaignId,
                fromActionId: actionId,
                toActionId: nextActionId,
                personsMoved: personIds.length,
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
        if (error instanceof NoNextActionError) {
          return mcpError(`Action ${String(actionId)} is the last action in campaign ${String(campaignId)}.`);
        }
        return mcpCatchAll(error, "Failed to move persons to next action");
      }
    },
  );
}
