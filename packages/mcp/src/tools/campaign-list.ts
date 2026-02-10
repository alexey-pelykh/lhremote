import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  CampaignRepository,
  DatabaseClient,
  discoverDatabase,
  errorMessage,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";
import { z } from "zod";

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
      // Connect to launcher to find account
      const launcher = new LauncherService(cdpPort);

      try {
        await launcher.connect();
      } catch (error) {
        if (error instanceof LinkedHelperNotRunningError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "LinkedHelper is not running. Use launch-app first.",
              },
            ],
          };
        }
        const message = errorMessage(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to connect to LinkedHelper: ${message}`,
            },
          ],
        };
      }

      let accountId: number;
      try {
        const accounts = await launcher.listAccounts();
        if (accounts.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "No accounts found.",
              },
            ],
          };
        }
        if (accounts.length > 1) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "Multiple accounts found. Cannot determine which instance to use.",
              },
            ],
          };
        }
        accountId = (accounts[0] as Account).id;
      } catch (error) {
        const message = errorMessage(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to list accounts: ${message}`,
            },
          ],
        };
      } finally {
        launcher.disconnect();
      }

      // Discover and open database
      let db: DatabaseClient | null = null;

      try {
        const dbPath = discoverDatabase(accountId);
        db = new DatabaseClient(dbPath);

        const campaignRepo = new CampaignRepository(db);
        const campaigns = campaignRepo.listCampaigns({ includeArchived });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { campaigns, total: campaigns.length },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = errorMessage(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to list campaigns: ${message}`,
            },
          ],
        };
      } finally {
        db?.close();
      }
    },
  );
}
