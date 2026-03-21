// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CampaignExecutionError, CampaignTimeoutError } from "@lhremote/core";
import { describe, expect, it } from "vitest";

import { createMockServer } from "./mock-server.js";

/**
 * Shared error tests for ephemeral-action-based MCP tools.
 *
 * Covers CampaignExecutionError and CampaignTimeoutError in addition to
 * the infrastructure errors tested by describeInfrastructureErrors.
 */
export function describeEphemeralActionErrors(
  registerTool: (server: McpServer) => void,
  toolName: string,
  getArgs: () => Record<string, unknown>,
  mockOperation: (error: Error) => void,
  errorPrefix: string,
): void {
  describe("ephemeral action errors", () => {
    it("returns error on campaign execution failure", async () => {
      const { server, getHandler } = createMockServer();
      registerTool(server);

      mockOperation(new CampaignExecutionError("Person 100 not found in database"));

      const handler = getHandler(toolName);
      const result = await handler(getArgs());

      expect(result).toEqual({
        isError: true,
        content: [
          {
            type: "text",
            text: `${errorPrefix}: Person 100 not found in database`,
          },
        ],
      });
    });

    it("returns error on campaign timeout", async () => {
      const { server, getHandler } = createMockServer();
      registerTool(server);

      mockOperation(new CampaignTimeoutError("Ephemeral action did not complete within 300000ms", 42));

      const handler = getHandler(toolName);
      const result = await handler(getArgs());

      expect(result).toEqual({
        isError: true,
        content: [
          {
            type: "text",
            text: `${errorPrefix}: Ephemeral action did not complete within 300000ms`,
          },
        ],
      });
    });
  });
}
