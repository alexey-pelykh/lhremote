// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { deleteCollection } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#delete-collection | delete-collection} MCP tool. */
export function registerDeleteCollection(server: McpServer): void {
  server.tool(
    "delete-collection",
    "Delete a LinkedHelper collection (List) and all its people associations",
    {
      collectionId: z
        .number()
        .int()
        .positive()
        .describe("Collection ID to delete"),
      ...cdpConnectionSchema,
    },
    async ({ collectionId, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await deleteCollection({ collectionId, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to delete collection");
      }
    },
  );
}
