import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignNotFoundError,
  CampaignRepository,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-get | campaign-get} MCP tool. */
export function registerCampaignGet(server: McpServer): void {
  server.tool(
    "campaign-get",
    "Get detailed information about a campaign including its actions and configuration",
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
        return await withDatabase(accountId, ({ db }) => {
          const campaignRepo = new CampaignRepository(db);
          const campaign = campaignRepo.getCampaign(campaignId);
          const actions = campaignRepo.getCampaignActions(campaignId);

          return mcpSuccess(JSON.stringify({ ...campaign, actions }, null, 2));
        });
      } catch (error) {
        if (error instanceof CampaignNotFoundError) {
          return mcpError(`Campaign ${String(campaignId)} not found.`);
        }
        return mcpCatchAll(error, "Failed to get campaign");
      }
    },
  );
}
