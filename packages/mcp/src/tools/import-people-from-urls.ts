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

/** Register the {@link https://github.com/alexey-pelykh/lhremote#import-people-from-urls | import-people-from-urls} MCP tool. */
export function registerImportPeopleFromUrls(server: McpServer): void {
  server.tool(
    "import-people-from-urls",
    "Import LinkedIn profile URLs into a campaign action's target list. Idempotent — re-importing an already-targeted person is a no-op.",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID to import people into"),
      linkedInUrls: z
        .array(z.string().url())
        .nonempty()
        .describe("LinkedIn profile URLs to import"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ campaignId, linkedInUrls, cdpPort }) => {
      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort);
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
          const campaignService = new CampaignService(instance, db);
          const result = await campaignService.importPeopleFromUrls(
            campaignId,
            linkedInUrls,
          );

          return mcpSuccess(
            JSON.stringify(
              {
                success: true,
                campaignId,
                actionId: result.actionId,
                imported: result.successful,
                alreadyInQueue: result.alreadyInQueue,
                alreadyProcessed: result.alreadyProcessed,
                failed: result.failed,
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
          return mcpError(`Failed to import people: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to import people");
      }
    },
  );
}
