import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  CampaignNotFoundError,
  CampaignRepository,
  DatabaseClient,
  discoverDatabase,
  LauncherService,
  LinkedHelperNotRunningError,
  serializeCampaignJson,
  serializeCampaignYaml,
} from "@lhremote/core";
import { z } from "zod";

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

      // Discover and open database
      let db: DatabaseClient | null = null;

      try {
        const dbPath = discoverDatabase(accountId);
        db = new DatabaseClient(dbPath);

        const campaignRepo = new CampaignRepository(db);
        const campaign = campaignRepo.getCampaign(campaignId);
        const actions = campaignRepo.getCampaignActions(campaignId);

        const config =
          format === "json"
            ? serializeCampaignJson(campaign, actions)
            : serializeCampaignYaml(campaign, actions);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { campaignId, format, config },
                null,
                2,
              ),
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
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to export campaign: ${message}`,
            },
          ],
        };
      } finally {
        db?.close();
      }
    },
  );
}
