// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { vi } from "vitest";

export function createMockServer() {
  const tools = new Map<
    string,
    (...args: unknown[]) => Promise<unknown>
  >();

  const server = {
    tool: vi.fn((...args: unknown[]) => {
      const name = args[0] as string;
      const handler = args[args.length - 1] as (
        ...a: unknown[]
      ) => Promise<unknown>;
      tools.set(name, handler);
    }),
  } as unknown as McpServer;

  function getHandler(name: string) {
    const handler = tools.get(name);
    if (!handler) throw new Error(`Tool "${name}" not registered`);
    return handler;
  }

  return { server, getHandler };
}
