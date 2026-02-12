import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignNotFoundError,
  CampaignRepository,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-retry | campaign-retry} MCP tool. */
export function registerCampaignRetry(server: McpServer): void {
  server.tool(
    "campaign-retry",
    "Reset specified people for re-run in a campaign (three-table reset without starting the campaign)",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to reset for retry"),
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
        return await withDatabase(accountId, ({ db }) => {
          const campaignRepo = new CampaignRepository(db);
          campaignRepo.resetForRerun(campaignId, personIds);

          return mcpSuccess(
            JSON.stringify(
              {
                success: true,
                campaignId,
                personsReset: personIds.length,
                message:
                  "Persons reset for retry. Use campaign-start to run the campaign.",
              },
              null,
              2,
            ),
          );
        }, { readOnly: false });
      } catch (error) {
        if (error instanceof CampaignNotFoundError) {
          return mcpError(`Campaign ${String(campaignId)} not found.`);
        }
        return mcpCatchAll(error, "Failed to reset persons for retry");
      }
    },
  );
}
