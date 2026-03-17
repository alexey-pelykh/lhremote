// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addPeopleToCollection } from "@lhremote/core";
import { z } from "zod";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#add-people-to-collection | add-people-to-collection} MCP tool. */
export function registerAddPeopleToCollection(server: McpServer): void {
  server.tool(
    "add-people-to-collection",
    "Add people to a LinkedHelper collection (List) by person IDs. Idempotent — adding an already-present person is a no-op.",
    {
      collectionId: z
        .number()
        .int()
        .positive()
        .describe("Collection ID to add people to"),
      personIds: z
        .array(z.number().int().positive())
        .nonempty()
        .describe("Person IDs to add to the collection"),
      ...cdpConnectionSchema,
    },
    async ({ collectionId, personIds, cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await addPeopleToCollection({ collectionId, personIds, cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to add people to collection");
      }
    },
  );
}
