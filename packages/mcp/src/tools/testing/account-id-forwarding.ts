// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Mock, describe, expect, it } from "vitest";

import { createMockServer } from "./mock-server.js";

/**
 * Shared regression test for issue #793: every MCP tool that includes
 * `cdpConnectionSchema` must forward the optional `accountId` arg to its
 * underlying core operation.
 *
 * Several wrappers historically destructured only
 * `{ cdpPort, cdpHost, allowRemote }` from the handler args and silently
 * dropped `accountId`, leaving multi-account users unable to target a
 * specific instance.
 *
 * Validates the supplied `baseArgs` (plus `cdpPort` and `accountId`) against
 * the tool's registered Zod schema before invoking the handler. This guards
 * the regression test against silent drift — if a caller spells a required
 * arg incorrectly (e.g. `urls` instead of `linkedInUrls`), the schema check
 * fails loudly rather than letting the handler take an early-validation exit
 * that bypasses the forwarding assertion.
 *
 * @param registerTool - The tool's register function (e.g. `registerCampaignList`).
 * @param toolName - The MCP tool name string (e.g. `"campaign-list"`).
 * @param mock - The mocked core operation (e.g. `vi.mocked(campaignList)`).
 * @param baseArgs - Args needed for the handler aside from `accountId` and
 *   `cdpPort`. `cdpPort: 9222` is supplied automatically and `accountId: 12345`
 *   is added by the helper. Defaults to `{}`.
 * @param mockResolvedValue - Value the mocked operation resolves with.
 *   Most handlers only `JSON.stringify` the result, so a permissive default
 *   suffices; pass an explicit shape for handlers that read result fields.
 *   Defaults to `{}`.
 */
export function describeAccountIdForwarding(opts: {
  registerTool: (server: McpServer) => void;
  toolName: string;
  mock: Mock;
  baseArgs?: Record<string, unknown>;
  mockResolvedValue?: unknown;
}): void {
  describe("accountId forwarding (regression #793)", () => {
    it("forwards accountId to the underlying operation when supplied", async () => {
      const { server, getHandler, getSchema } = createMockServer();
      opts.registerTool(server);

      opts.mock.mockResolvedValue(opts.mockResolvedValue ?? {});

      const args = {
        cdpPort: 9222,
        ...(opts.baseArgs ?? {}),
        accountId: 12345,
      };

      // Guard against drift: validate args against the tool's registered
      // Zod schema before invoking the handler. Catches stale `baseArgs`
      // entries that would otherwise let the handler short-circuit on
      // missing/wrong required fields and bypass the forwarding assertion.
      const schema = getSchema(opts.toolName);
      if (schema) {
        const parsed = schema.safeParse(args);
        expect(
          parsed.success,
          parsed.success ? "" : `baseArgs failed schema validation for ${opts.toolName}: ${parsed.error.message}`,
        ).toBe(true);
      }

      const handler = getHandler(opts.toolName);
      await handler(args);

      expect(opts.mock).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 12345 }),
      );
    });
  });
}
