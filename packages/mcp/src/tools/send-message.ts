import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Account,
  discoverInstancePort,
  InstanceNotRunningError,
  InstanceService,
  LauncherService,
  LinkedHelperNotRunningError,
  parseMessageTemplate,
} from "@lhremote/core";
import { z } from "zod";

export function registerSendMessage(server: McpServer): void {
  server.tool(
    "send-message",
    "Send a direct LinkedIn message to a 1st-degree connection via LinkedHelper's MessageToPerson action. Supports template variables like {firstName}, {lastName}, {company}, {position}, {location} that LinkedHelper substitutes from the person's profile.",
    {
      personId: z
        .number()
        .int()
        .positive()
        .describe("Target person's internal ID"),
      message: z
        .string()
        .min(1)
        .describe(
          "Message text. Use {firstName}, {lastName}, {company}, {position}, {location} for template variables",
        ),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ personId, message, cdpPort }) => {
      // Parse message template before connecting (fail fast on invalid variables)
      let messageTemplate;
      try {
        messageTemplate = parseMessageTemplate(message);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Invalid message template: ${errorMessage}`,
            },
          ],
        };
      }

      // Connect to launcher to verify LinkedHelper is running
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
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to connect to LinkedHelper: ${errorMessage}`,
            },
          ],
        };
      }

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
        // Suppress unused variable - we verify single account exists
        void (accounts[0] as Account);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to list accounts: ${errorMessage}`,
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

      // Connect to instance and execute action
      const instance = new InstanceService(instancePort);

      try {
        await instance.connect();

        // Execute the MessageToPerson action
        await instance.executeAction("MessageToPerson", {
          personIds: [personId],
          messageTemplate,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  personId,
                  actionType: "MessageToPerson",
                },
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
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to send message: ${errorMessage}`,
            },
          ],
        };
      } finally {
        instance.disconnect();
      }
    },
  );
}
