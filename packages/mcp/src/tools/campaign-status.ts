import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  errorMessage,
  InstanceNotRunningError,
  InstanceService,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";
import { z } from "zod";

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

      // Connect to instance and get campaign status
      const instance = new InstanceService(instancePort);
      let db: DatabaseClient | null = null;

      try {
        await instance.connect();

        // Discover and open database
        const dbPath = discoverDatabase(accountId);
        db = new DatabaseClient(dbPath);

        const campaignService = new CampaignService(instance, db);
        const status = await campaignService.getStatus(campaignId);

        const response: Record<string, unknown> = { campaignId, ...status };

        if (includeResults) {
          const runResult = await campaignService.getResults(campaignId);
          response.results = runResult.results.slice(0, limit);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response, null, 2),
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
                text: `Failed to get campaign status: ${error.message}`,
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
              text: `Failed to get campaign status: ${message}`,
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
