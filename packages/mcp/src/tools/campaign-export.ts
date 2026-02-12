import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignNotFoundError,
  CampaignRepository,
  resolveAccount,
  serializeCampaignJson,
  serializeCampaignYaml,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-export | campaign-export} MCP tool. */
export function registerCampaignExport(server: McpServer): void {
  server.tool(
    "campaign-export",
    "Export a campaign configuration as YAML or JSON for backup or reuse",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      format: z
        .enum(["yaml", "json"])
        .optional()
        .default("yaml")
        .describe("Export format"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ campaignId, format, cdpPort }) => {
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

          const config =
            format === "json"
              ? serializeCampaignJson(campaign, actions)
              : serializeCampaignYaml(campaign, actions);

          return mcpSuccess(
            JSON.stringify(
              { campaignId, format, config },
              null,
              2,
            ),
          );
        });
      } catch (error) {
        if (error instanceof CampaignNotFoundError) {
          return mcpError(`Campaign ${String(campaignId)} not found.`);
        }
        return mcpCatchAll(error, "Failed to export campaign");
      }
    },
  );
}
