import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  ExtractionTimeoutError,
  InstanceNotRunningError,
  InstanceService,
  LauncherService,
  LinkedHelperNotRunningError,
  ProfileService,
  type Account,
} from "@lhremote/core";
import { z } from "zod";

export function registerVisitAndExtract(server: McpServer): void {
  server.tool(
    "visit-and-extract",
    "Visit a LinkedIn profile via LinkedHelper and extract all available data (name, positions, education, skills, emails). Requires a running instance.",
    {
      profileUrl: z
        .string()
        .url()
        .describe(
          "LinkedIn profile URL (e.g., https://www.linkedin.com/in/username)",
        ),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Extraction timeout in milliseconds (default: 30000). Increase for complex profiles or slow networks.",
        ),
    },
    async ({ profileUrl, cdpPort, timeout }) => {
      // Validate LinkedIn URL format
      if (!isLinkedInProfileUrl(profileUrl)) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Invalid LinkedIn profile URL. Expected: https://www.linkedin.com/in/username",
            },
          ],
        };
      }

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

      // Connect to instance
      const instance = new InstanceService(instancePort);
      let db: DatabaseClient | null = null;

      try {
        await instance.connect();

        // Discover and open database
        const dbPath = discoverDatabase(accountId);
        db = new DatabaseClient(dbPath);

        // Run visit-and-extract workflow
        const profileService = new ProfileService(instance, db);
        const profile = await profileService.visitAndExtract(profileUrl, {
          ...(timeout !== undefined && { pollTimeout: timeout }),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(profile, null, 2),
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
        if (error instanceof ExtractionTimeoutError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "Profile extraction timed out. The profile may not have loaded correctly.",
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
              text: `Failed to extract profile: ${message}`,
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

function isLinkedInProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === "www.linkedin.com" ||
        parsed.hostname === "linkedin.com") &&
      parsed.pathname.startsWith("/in/")
    );
  } catch {
    return false;
  }
}
