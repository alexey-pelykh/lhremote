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

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-stop | campaign-stop} MCP tool. */
export function registerCampaignStop(server: McpServer): void {
  server.tool(
    "campaign-stop",
    "Stop a running campaign",
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
          await campaignService.stop(campaignId);

          return mcpSuccess(
            JSON.stringify(
              {
                success: true,
                campaignId,
                message: "Campaign paused",
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
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to stop campaign: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to stop campaign");
      }
    },
  );
}
