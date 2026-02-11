import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  DatabaseClient,
  discoverDatabase,
  errorMessage,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";
import { z } from "zod";

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

      // Discover and open database (read-only)
      let db: DatabaseClient | null = null;

      try {
        const dbPath = discoverDatabase(accountId);
        db = new DatabaseClient(dbPath);

        const campaignRepo = new CampaignRepository(db);
        const statsOptions: { actionId?: number; maxErrors?: number } = { maxErrors };
        if (actionId !== undefined) statsOptions.actionId = actionId;
        const statistics = campaignRepo.getStatistics(campaignId, statsOptions);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(statistics, null, 2),
            },
          ],
        };
      } catch (error) {
        if (error instanceof CampaignNotFoundError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Campaign ${String(campaignId)} not found.`,
              },
            ],
          };
        }
        if (error instanceof ActionNotFoundError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Action ${String(actionId)} not found in campaign ${String(campaignId)}.`,
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
              text: `Failed to get campaign statistics: ${message}`,
            },
          ],
        };
      } finally {
        db?.close();
      }
    },
  );
}
