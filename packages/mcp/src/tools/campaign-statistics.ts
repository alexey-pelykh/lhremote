import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-statistics | campaign-statistics} MCP tool. */
export function registerCampaignStatistics(server: McpServer): void {
  server.tool(
    "campaign-statistics",
    "Get per-action success/failure/skip rates, top error codes with blame attribution, and processing timeline for a campaign.",
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
        .describe("Filter to a specific action ID"),
      maxErrors: z
        .number()
        .int()
        .positive()
        .optional()
        .default(5)
        .describe("Maximum number of top errors per action (default: 5)"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ campaignId, actionId, maxErrors, cdpPort }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort);
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withDatabase(accountId, ({ db }) => {
          const campaignRepo = new CampaignRepository(db);
          const statsOptions: { actionId?: number; maxErrors?: number } = { maxErrors };
          if (actionId !== undefined) statsOptions.actionId = actionId;
          const statistics = campaignRepo.getStatistics(campaignId, statsOptions);

          return mcpSuccess(JSON.stringify(statistics, null, 2));
        });
      } catch (error) {
        if (error instanceof CampaignNotFoundError) {
          return mcpError(`Campaign ${String(campaignId)} not found.`);
        }
        if (error instanceof ActionNotFoundError) {
          return mcpError(`Action ${String(actionId)} not found in campaign ${String(campaignId)}.`);
        }
        return mcpCatchAll(error, "Failed to get campaign statistics");
      }
    },
  );
}
