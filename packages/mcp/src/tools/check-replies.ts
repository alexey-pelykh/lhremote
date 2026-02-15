// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  checkReplies,
} from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#check-replies | check-replies} MCP tool. */
export function registerCheckReplies(server: McpServer): void {
  server.tool(
    "check-replies",
    "Trigger LinkedHelper to check for new message replies on LinkedIn, then return any new messages found. If `since` is omitted, returns messages from the last 24 hours.",
    {
      since: z
        .string()
        .optional()
        .describe(
          "ISO timestamp; only return messages after this time. If omitted, returns messages from the last 24 hours",
        ),
      ...cdpConnectionSchema,
    },
    async ({ since, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await checkReplies({ since, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to check replies");
      }
    },
  );
}
