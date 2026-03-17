// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createCollection } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#create-collection | create-collection} MCP tool. */
export function registerCreateCollection(server: McpServer): void {
  server.tool(
    "create-collection",
    "Create a new named LinkedHelper collection (List)",
    {
      name: z
        .string()
        .min(1)
        .describe("Name for the new collection"),
      ...cdpConnectionSchema,
    },
    async ({ name, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await createCollection({ name, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to create collection");
      }
    },
  );
}
