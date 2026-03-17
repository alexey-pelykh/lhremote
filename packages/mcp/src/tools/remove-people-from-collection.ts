// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { removePeopleFromCollection } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#remove-people-from-collection | remove-people-from-collection} MCP tool. */
export function registerRemovePeopleFromCollection(server: McpServer): void {
  server.tool(
    "remove-people-from-collection",
    "Remove people from a LinkedHelper collection (List) by person IDs",
    {
      collectionId: z
        .number()
        .int()
        .positive()
        .describe("Collection ID to remove people from"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to remove from the collection"),
      ...cdpConnectionSchema,
    },
    async ({ collectionId, personIds, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await removePeopleFromCollection({ collectionId, personIds, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to remove people from collection");
      }
    },
  );
}
