// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { removeConnection } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#remove-connection | remove-connection} MCP tool. */
export function registerRemoveConnection(server: McpServer): void {
  server.tool(
    "remove-connection",
    "Remove a person from 1st-degree LinkedIn connections (unfriend) via an ephemeral campaign. Accepts a person ID or LinkedIn profile URL. Deducts from the daily action budget.",
    {
      personId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Internal person ID"),
      url: z
        .string()
        .optional()
        .describe("LinkedIn profile URL (e.g. https://www.linkedin.com/in/jane-doe)"),
      keepCampaign: z
        .boolean()
        .optional()
        .describe("Archive the ephemeral campaign instead of deleting it"),
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum time to wait for action completion in milliseconds (default: 5 min)"),
      ...cdpConnectionSchema,
    },
    async ({ personId, url, keepCampaign, timeout, cdpPort, cdpHost, allowRemote, accountId }) => {
      if ((personId == null) === (url == null)) {
        return mcpError("Exactly one of personId or url must be provided.");
      }

      try {
        const result = await removeConnection({
          personId, url, keepCampaign, timeout, cdpPort, cdpHost, allowRemote, accountId,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to remove connection");
      }
    },
  );
}
