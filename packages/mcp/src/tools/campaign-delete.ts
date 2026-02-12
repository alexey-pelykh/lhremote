import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-delete | campaign-delete} MCP tool. */
export function registerCampaignDelete(server: McpServer): void {
  server.tool(
    "campaign-delete",
    "Delete (archive) a campaign. The campaign is hidden but retained in database.",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ campaignId, cdpPort }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort);
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
          const campaignService = new CampaignService(instance, db);
          await campaignService.delete(campaignId);

          return mcpSuccess(
            JSON.stringify(
              { success: true, campaignId, action: "archived" },
              null,
              2,
            ),
          );
        });
      } catch (error) {
        if (error instanceof CampaignNotFoundError) {
          return mcpError(`Campaign ${String(campaignId)} not found.`);
        }
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to delete campaign: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to delete campaign");
      }
    },
  );
}
