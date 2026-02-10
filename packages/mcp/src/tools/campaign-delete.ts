import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  InstanceNotRunningError,
  InstanceService,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";
import { z } from "zod";

export function registerCampaignDelete(server: McpServer): void {
  server.tool(
    "campaign-delete",
    "Delete (archive) a campaign. The campaign is hidden but retained in database.",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ campaignId, cdpPort }) => {
      // Connect to launcher to find running instance
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
        const message =
          error instanceof Error ? error.message : String(error);
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
        const message =
          error instanceof Error ? error.message : String(error);
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

      // Discover instance CDP port
      const instancePort = await discoverInstancePort(cdpPort);
      if (instancePort === null) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "No LinkedHelper instance is running. Use start-instance first.",
            },
          ],
        };
      }

      // Connect to instance and delete campaign
      const instance = new InstanceService(instancePort);
      let db: DatabaseClient | null = null;

      try {
        await instance.connect();

        // Discover and open database
        const dbPath = discoverDatabase(accountId);
        db = new DatabaseClient(dbPath);

        // Delete (archive) campaign
        const campaignService = new CampaignService(instance, db);
        await campaignService.delete(campaignId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, campaignId, action: "archived" },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        if (error instanceof InstanceNotRunningError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "No LinkedHelper instance is running. Use start-instance first.",
              },
            ],
          };
        }
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
        if (error instanceof CampaignExecutionError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Failed to delete campaign: ${error.message}`,
              },
            ],
          };
        }
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to delete campaign: ${message}`,
            },
          ],
        };
      } finally {
        instance.disconnect();
        db?.close();
      }
    },
  );
}
