import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-reorder-actions | campaign-reorder-actions} MCP tool. */
export function registerCampaignReorderActions(server: McpServer): void {
  server.tool(
    "campaign-reorder-actions",
    "Reorder actions in a campaign's action chain",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      actionIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Action IDs in the desired order"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ campaignId, actionIds, cdpPort }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort);
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
          const campaignService = new CampaignService(instance, db);
          const updatedActions = await campaignService.reorderActions(
            campaignId,
            actionIds,
          );

          return mcpSuccess(
            JSON.stringify(
              {
                success: true,
                campaignId,
                actions: updatedActions,
              },
              null,
              2,
            ),
          );
        });
      } catch (error) {
        if (error instanceof CampaignNotFoundError) {
          return mcpError(`Campaign ${String(campaignId)} not found.`);
        }
        if (error instanceof ActionNotFoundError) {
          return mcpError(`One or more action IDs not found in campaign ${String(campaignId)}.`);
        }
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to reorder actions: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to reorder actions");
      }
    },
  );
}
