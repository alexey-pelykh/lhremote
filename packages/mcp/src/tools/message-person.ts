// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { messagePerson } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpError, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#message-person | message-person} MCP tool. */
export function registerMessagePerson(server: McpServer): void {
  server.tool(
    "message-person",
    "Send a direct message to a 1st-degree LinkedIn connection via an ephemeral campaign. Accepts a person ID or LinkedIn profile URL. Deducts from the daily action budget.",
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
        .describe("Message template as JSON string (required)"),
      subjectTemplate: z
        .string()
        .optional()
        .describe("Subject line template as JSON string"),
      rejectIfReplied: z
        .boolean()
        .optional()
        .describe("Skip if person already replied"),
      rejectIfMessaged: z
        .boolean()
        .optional()
        .describe("Skip if already messaged"),
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
    async ({ personId, url, messageTemplate, subjectTemplate, rejectIfReplied, rejectIfMessaged, keepCampaign, timeout, cdpPort, cdpHost, allowRemote, accountId }) => {
      if ((personId == null) === (url == null)) {
        return mcpError("Exactly one of personId or url must be provided.");
      }

      let parsedMessageTemplate: Record<string, unknown>;
      try {
        parsedMessageTemplate = JSON.parse(messageTemplate) as Record<string, unknown>;
      } catch {
        return mcpError("Invalid JSON in messageTemplate.");
      }

      let parsedSubjectTemplate: Record<string, unknown> | undefined;
      if (subjectTemplate) {
        try {
          parsedSubjectTemplate = JSON.parse(subjectTemplate) as Record<string, unknown>;
        } catch {
          return mcpError("Invalid JSON in subjectTemplate.");
        }
      }

      try {
        const result = await messagePerson({
          personId, url, messageTemplate: parsedMessageTemplate, subjectTemplate: parsedSubjectTemplate,
          rejectIfReplied, rejectIfMessaged, keepCampaign, timeout, cdpPort, cdpHost, allowRemote, accountId,
        });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to send message");
      }
    },
  );
}
