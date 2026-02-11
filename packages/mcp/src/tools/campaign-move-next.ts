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
  NoNextActionError,
} from "@lhremote/core";
import { z } from "zod";

export function registerCampaignMoveNext(server: McpServer): void {
  server.tool(
    "campaign-move-next",
    "Move people from one action to the next action in a campaign chain (without executing the current action)",
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
        .describe("Action ID to move people from"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to advance to the next action"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ campaignId, actionId, personIds, cdpPort }) => {
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

      // Discover and open database (writable for move)
      let db: DatabaseClient | null = null;

      try {
        const dbPath = discoverDatabase(accountId);
        db = new DatabaseClient(dbPath, { readOnly: false });

        const campaignRepo = new CampaignRepository(db);
        const { nextActionId } = campaignRepo.moveToNextAction(
          campaignId,
          actionId,
          personIds,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  campaignId,
                  fromActionId: actionId,
                  toActionId: nextActionId,
                  personsMoved: personIds.length,
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
        if (error instanceof NoNextActionError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Action ${String(actionId)} is the last action in campaign ${String(campaignId)}.`,
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
              text: `Failed to move persons to next action: ${message}`,
            },
          ],
        };
      } finally {
        db?.close();
      }
    },
  );
}
