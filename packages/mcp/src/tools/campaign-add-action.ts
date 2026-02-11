import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  CampaignNotFoundError,
  CampaignRepository,
  DatabaseClient,
  discoverDatabase,
  errorMessage,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";
import { z } from "zod";

export function registerCampaignAddAction(server: McpServer): void {
  server.tool(
    "campaign-add-action",
    "Add a new action to an existing campaign's action chain",
    {
      campaignId: z
        .number()
        .int()
        .positive()
        .describe("Campaign ID"),
      name: z
        .string()
        .describe("Display name for the action"),
      actionType: z
        .string()
        .describe("Action type identifier (e.g., 'VisitAndExtract', 'MessageToPerson')"),
      description: z
        .string()
        .optional()
        .describe("Optional action description"),
      coolDown: z
        .number()
        .int()
        .optional()
        .describe("Milliseconds between action executions (default: 60000)"),
      maxActionResultsPerIteration: z
        .number()
        .int()
        .optional()
        .describe("Maximum results per iteration (default: 10, -1 for unlimited)"),
      actionSettings: z
        .string()
        .optional()
        .describe("Action-specific settings as a JSON string"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({
      campaignId,
      name,
      actionType,
      description,
      coolDown,
      maxActionResultsPerIteration,
      actionSettings,
      cdpPort,
    }) => {
      // Parse action settings JSON if provided
      let parsedSettings: Record<string, unknown> = {};
      if (actionSettings !== undefined) {
        try {
          parsedSettings = JSON.parse(actionSettings) as Record<string, unknown>;
        } catch {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "Invalid JSON in actionSettings.",
              },
            ],
          };
        }
      }

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

      // Discover and open database (writable for add)
      let db: DatabaseClient | null = null;

      try {
        const dbPath = discoverDatabase(accountId);
        db = new DatabaseClient(dbPath, { readOnly: false });

        const campaignRepo = new CampaignRepository(db);
        const campaign = campaignRepo.getCampaign(campaignId);

        const actionConfig: import("@lhremote/core").CampaignActionConfig = {
          name,
          actionType,
          actionSettings: parsedSettings,
        };
        if (description !== undefined) {
          actionConfig.description = description;
        }
        if (coolDown !== undefined) {
          actionConfig.coolDown = coolDown;
        }
        if (maxActionResultsPerIteration !== undefined) {
          actionConfig.maxActionResultsPerIteration =
            maxActionResultsPerIteration;
        }

        const action = campaignRepo.addAction(
          campaignId,
          actionConfig,
          campaign.liAccountId,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(action, null, 2),
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
        const message = errorMessage(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to add action to campaign: ${message}`,
            },
          ],
        };
      } finally {
        db?.close();
      }
    },
  );
}
