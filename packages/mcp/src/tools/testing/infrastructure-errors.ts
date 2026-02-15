// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LinkedHelperNotRunningError, resolveAccount } from "@lhremote/core";
import { describe, expect, it, vi } from "vitest";

import { createMockServer } from "./mock-server.js";

/**
 * Shared infrastructure error tests for MCP tools that use `resolveAccount`.
 *
 * Covers the two error paths common to all such tools:
 * - `LinkedHelperNotRunningError` → fixed "LinkedHelper is not running" message
 * - Generic connection error → `"${connectionErrorPrefix}: <message>"` message
 *
 * @param registerTool - Function that registers the tool under test on an MCP server.
 * @param toolName - The registered tool name (used to look up the handler).
 * @param getArgs - Returns the arguments to invoke the handler with.
 * @param connectionErrorPrefix - The expected prefix in the generic connection error message
 *   (e.g. `"Failed to connect to LinkedHelper"`). If omitted, the generic connection error
 *   test is skipped (some tools only test the `LinkedHelperNotRunningError` path).
 */
export function describeInfrastructureErrors(
  registerTool: (server: McpServer) => void,
  toolName: string,
  getArgs: () => Record<string, unknown>,
  connectionErrorPrefix?: string,
): void {
  describe("infrastructure errors", () => {
    it("returns error when LinkedHelper is not running", async () => {
      const { server, getHandler } = createMockServer();
      registerTool(server);

      vi.mocked(resolveAccount).mockRejectedValue(
        new LinkedHelperNotRunningError(9222),
      );

      const handler = getHandler(toolName);
      const result = await handler(getArgs());

      expect(result).toEqual({
        isError: true,
        content: [
          {
            type: "text",
            text: "LinkedHelper is not running. Use launch-app first.",
          },
        ],
      });
    });

    if (connectionErrorPrefix) {
      it("returns error when connection fails", async () => {
        const { server, getHandler } = createMockServer();
        registerTool(server);

        vi.mocked(resolveAccount).mockRejectedValue(
          new Error("connection refused"),
        );

        const handler = getHandler(toolName);
        const result = await handler(getArgs());

        expect(result).toEqual({
          isError: true,
          content: [
            {
              type: "text",
              text: `${connectionErrorPrefix}: connection refused`,
            },
          ],
        });
      });
    }
  });
}
