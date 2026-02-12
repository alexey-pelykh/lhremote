import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignRepository,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-list | campaign-list} MCP tool. */
export function registerCampaignList(server: McpServer): void {
  server.tool(
    "campaign-list",
    "List existing LinkedHelper campaigns with summary statistics",
    {
      includeArchived: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include archived campaigns"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ includeArchived, cdpPort }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort);
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withDatabase(accountId, ({ db }) => {
          const campaignRepo = new CampaignRepository(db);
          const campaigns = campaignRepo.listCampaigns({ includeArchived });

          return mcpSuccess(
            JSON.stringify(
              { campaigns, total: campaigns.length },
              null,
              2,
            ),
          );
        });
      } catch (error) {
        return mcpCatchAll(error, "Failed to list campaigns");
      }
    },
  );
}
