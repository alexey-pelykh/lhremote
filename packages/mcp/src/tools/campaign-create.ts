import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignExecutionError,
  CampaignFormatError,
  CampaignService,
  errorMessage,
  parseCampaignJson,
  parseCampaignYaml,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";
import { z } from "zod";
import { mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#campaign-create | campaign-create} MCP tool. */
export function registerCampaignCreate(server: McpServer): void {
  server.tool(
    "campaign-create",
    "Create a new LinkedHelper campaign from YAML or JSON configuration",
    {
      config: z.string().describe("Campaign configuration in YAML or JSON format"),
      format: z
        .enum(["yaml", "json"])
        .optional()
        .default("yaml")
        .describe("Configuration format"),
      cdpPort: z
        .number()
        .int()
        .positive()
        .optional()
        .default(9222)
        .describe("CDP port (default: 9222)"),
    },
    async ({ config, format, cdpPort }) => {
      // Parse campaign config
      let parsedConfig;
      try {
        parsedConfig =
          format === "json"
            ? parseCampaignJson(config)
            : parseCampaignYaml(config);
      } catch (error) {
        if (error instanceof CampaignFormatError) {
          return mcpError(`Invalid campaign configuration: ${error.message}`);
        }
        const message = errorMessage(error);
        return mcpError(`Failed to parse campaign configuration: ${message}`);
      }

      let accountId: number;
      try {
        accountId = await resolveAccount(cdpPort);
      } catch (error) {
        return mcpCatchAll(error, "Failed to connect to LinkedHelper");
      }

      try {
        return await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
          const campaignService = new CampaignService(instance, db);
          const campaign = await campaignService.create(parsedConfig);

          return mcpSuccess(JSON.stringify(campaign, null, 2));
        });
      } catch (error) {
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to create campaign: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to create campaign");
      }
    },
  );
}
