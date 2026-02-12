import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  CampaignTimeoutError,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-start | campaign-start} MCP tool. */
export function registerCampaignStart(server: McpServer): void {
  server.tool(
    "campaign-start",
    "Start a campaign with specified target persons. Returns immediately (async execution).",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to target"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ campaignId, personIds, cdpPort }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort);
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
          const campaignService = new CampaignService(instance, db);
          await campaignService.start(campaignId, personIds);

          return mcpSuccess(
            JSON.stringify(
              {
                success: true,
                campaignId,
                personsQueued: personIds.length,
                message:
                  "Campaign started. Use campaign-status to monitor progress.",
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
        if (error instanceof CampaignTimeoutError) {
          return mcpError(`Campaign start timed out: ${error.message}`);
        }
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to start campaign: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to start campaign");
      }
    },
  );
}
