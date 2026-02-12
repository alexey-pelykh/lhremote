import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignNotFoundError,
  CampaignRepository,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-update | campaign-update} MCP tool. */
export function registerCampaignUpdate(server: McpServer): void {
  server.tool(
    "campaign-update",
    "Update a campaign's name and/or description",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      name: z
        .string()
        .optional()
        .describe("New campaign name"),
      description: z
        .string()
        .nullable()
        .optional()
        .describe("New campaign description (null to clear)"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ campaignId, name, description, cdpPort }) => {
      // Validate that at least one field is provided
      if (name === undefined && description === undefined) {
        return mcpError("At least one of name or description must be provided.");
      }

      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort);
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withDatabase(accountId, ({ db }) => {
          const campaignRepo = new CampaignRepository(db);
          const updates: { name?: string; description?: string | null } = {};
          if (name !== undefined) updates.name = name;
          if (description !== undefined) updates.description = description;

          const campaign = campaignRepo.updateCampaign(campaignId, updates);

          return mcpSuccess(JSON.stringify(campaign, null, 2));
        }, { readOnly: false });
      } catch (error) {
        if (error instanceof CampaignNotFoundError) {
          return mcpError(`Campaign ${String(campaignId)} not found.`);
        }
        return mcpCatchAll(error, "Failed to update campaign");
      }
    },
  );
}
