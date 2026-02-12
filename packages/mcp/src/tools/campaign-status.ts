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

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-status | campaign-status} MCP tool. */
export function registerCampaignStatus(server: McpServer): void {
  server.tool(
    "campaign-status",
    "Check campaign execution status and results. Use after campaign-start to monitor progress.",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      includeResults: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include execution results"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .default(20)
        .describe("Max results to return"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ campaignId, includeResults, limit, cdpPort }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort);
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
          const campaignService = new CampaignService(instance, db);
          const status = await campaignService.getStatus(campaignId);

          const response: Record<string, unknown> = { campaignId, ...status };

          if (includeResults) {
            const runResult = await campaignService.getResults(campaignId);
            response.results = runResult.results.slice(0, limit);
          }

          return mcpSuccess(JSON.stringify(response, null, 2));
        });
      } catch (error) {
        if (error instanceof CampaignNotFoundError) {
          return mcpError(`Campaign ${String(campaignId)} not found.`);
        }
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to get campaign status: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to get campaign status");
      }
    },
  );
}
