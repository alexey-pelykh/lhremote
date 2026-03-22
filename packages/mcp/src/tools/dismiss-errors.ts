// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dismissErrors } from "@lhremote/core";
import { cdpConnectionSchema, mcpCatchAll, mcpSuccess } from "../helpers.js";

/** Register the {@link https://github.com/alexey-pelykh/lhremote#dismiss-errors | dismiss-errors} MCP tool. */
export function registerDismissErrors(server: McpServer): void {
  server.tool(
    "dismiss-errors",
    "Dismiss closable error popups in LinkedHelper instance UI by clicking their close/OK buttons. Use this tool when operations fail with UI errors or when get-errors reports closable popups. Recommended after UIBlockedError.",
    {
      ...cdpConnectionSchema,
    },
    async ({ cdpPort, cdpHost, allowRemote }) => {
      try {
        const result = await dismissErrors({ cdpPort, cdpHost, allowRemote });
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpCatchAll(error, "Failed to dismiss errors");
      }
    },
  );
}
