// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { vi } from "vitest";
import type { ZodRawShape } from "zod";
import { z } from "zod";

interface ToolEntry {
  handler: (...args: unknown[]) => Promise<unknown>;
  schema: z.ZodObject<ZodRawShape> | undefined;
}

export function createMockServer() {
  const tools = new Map<string, ToolEntry>();

  const server = {
    tool: vi.fn((...args: unknown[]) => {
      const name = args[0] as string;
      const handler = args[args.length - 1] as (
        ...a: unknown[]
      ) => Promise<unknown>;
      // server.tool(name, description, schema, handler)
      const rawSchema =
        args.length >= 4
          ? (args[2] as ZodRawShape | undefined)
          : undefined;
      const schema = rawSchema ? z.object(rawSchema) : undefined;
      tools.set(name, { handler, schema });
    }),
  } as unknown as McpServer;

  function getHandler(name: string) {
    const entry = tools.get(name);
    if (!entry) throw new Error(`Tool "${name}" not registered`);
    return entry.handler;
  }

  function getSchema(name: string) {
    const entry = tools.get(name);
    if (!entry) throw new Error(`Tool "${name}" not registered`);
    return entry.schema;
  }

  return { server, getHandler, getSchema };
}
