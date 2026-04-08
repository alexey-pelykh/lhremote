// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendInvite } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#send-invite | send-invite} MCP tool. */
export function registerSendInvite(server: McpServer): void {
  server.tool(
    "send-invite",
    "Send a LinkedIn connection request via an ephemeral campaign. Accepts a person ID or LinkedIn profile URL. Deducts from the daily action budget.",
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
      messageTemplate: z
        .string()
        .optional()
        .describe("Invitation message template as JSON string (empty for no message)"),
      saveAsLeadSN: z
        .boolean()
        .optional()
        .describe("Save as lead in Sales Navigator (default: false)"),
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
    async ({ personId, url, messageTemplate, saveAsLeadSN, keepCampaign, timeout, cdpPort, cdpHost, allowRemote, accountId }) => {
      if ((personId == null) === (url == null)) {
        return mcpError("Exactly one of personId or url must be provided.");
      }

      let parsedMessageTemplate: Record<string, unknown> | undefined;
      if (messageTemplate) {
        try {
          parsedMessageTemplate = JSON.parse(messageTemplate) as Record<string, unknown>;
        } catch {
          return mcpError("Invalid JSON in messageTemplate.");
        }
      }

      try {
        const result = await sendInvite({
          personId, url, messageTemplate: parsedMessageTemplate, saveAsLeadSN,
          keepCampaign, timeout, cdpPort, cdpHost, allowRemote, accountId,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to send invite");
      }
    },
  );
}
