// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CampaignExecutionError,
  CampaignFormatError,
  campaignCreate,
  errorMessage,
  parseCampaignJson,
  parseCampaignYaml,
} from "@lhremote/core";
import { z } from "zod";
import {
  cdpConnectionSchema,
  mcpCatchAll,
  mcpError,
  mcpSuccess,
} from "../helpers.js";

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
      ...cdpConnectionSchema,
    },
    async ({ config, format, cdpPort, cdpHost, allowRemote }) => {
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

      try {
        const result = await campaignCreate({ config: parsedConfig, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof CampaignExecutionError) {
          return mcpError(`Failed to create campaign: ${error.message}`);
        }
        return mcpCatchAll(error, "Failed to create campaign");
      }
    },
  );
}
