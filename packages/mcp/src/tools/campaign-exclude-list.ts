import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  DatabaseClient,
  discoverDatabase,
  errorMessage,
  ExcludeListNotFoundError,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";
import { z } from "zod";

export function registerCampaignExcludeList(server: McpServer): void {
  server.tool(
    "campaign-exclude-list",
    "View the exclude list for a campaign or a specific action within a campaign",
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
        .describe(
          "Action ID (optional). If provided, shows the action-level exclude list. Otherwise, shows the campaign-level exclude list.",
        ),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ campaignId, actionId, cdpPort }) => {
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

      let db: DatabaseClient | null = null;

      try {
        const dbPath = discoverDatabase(accountId);
        db = new DatabaseClient(dbPath);

        const campaignRepo = new CampaignRepository(db);
        const entries = campaignRepo.getExcludeList(campaignId, actionId);

        const level = actionId !== undefined ? "action" : "campaign";
        const targetLabel =
          actionId !== undefined
            ? `action ${String(actionId)} in campaign ${String(campaignId)}`
            : `campaign ${String(campaignId)}`;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  campaignId,
                  ...(actionId !== undefined ? { actionId } : {}),
                  level,
                  count: entries.length,
                  personIds: entries.map((e) => e.personId),
                  message: `Exclude list for ${targetLabel}: ${String(entries.length)} person(s).`,
                },
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
        if (error instanceof ExcludeListNotFoundError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: error.message,
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
              text: `Failed to get exclude list: ${message}`,
            },
          ],
        };
      } finally {
        db?.close();
      }
    },
  );
}
