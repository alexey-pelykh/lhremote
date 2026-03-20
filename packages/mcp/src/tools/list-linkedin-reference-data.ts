// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getLinkedInReferenceData } from "@lhremote/core";
import { z } from "zod";
import { mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#list-linkedin-reference-data | list-linkedin-reference-data} MCP tool. */
export function registerListLinkedInReferenceData(server: McpServer): void {
  server.tool(
    "list-linkedin-reference-data",
    "List LinkedIn reference data for finite enumerations (industries, seniority levels, functions, company sizes, connection degrees, profile languages). Use this to discover valid IDs for search filters.",
    {
      dataType: z
        .enum([
          "INDUSTRY",
          "SENIORITY",
          "FUNCTION",
          "COMPANY_SIZE",
          "CONNECTION_DEGREE",
          "PROFILE_LANGUAGE",
        ])
        .describe("Type of reference data to list"),
    },
    async ({ dataType }) => {
      const items = getLinkedInReferenceData(dataType);
      return mcpSuccess(
        JSON.stringify({ dataType, items }, null, 2),
      );
    },
  );
}
