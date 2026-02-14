// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(
  __dirname,
  "../../../core/src/db/testing/fixture.db",
);

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    resolveAccount: vi.fn(),
    withDatabase: vi.fn(),
  };
});

import { DatabaseClient, resolveAccount, withDatabase } from "@lhremote/core";
import type { DatabaseContext } from "@lhremote/core";

import { registerQueryMessages } from "./query-messages.js";
import { createMockServer } from "./testing/mock-server.js";

describe("registerQueryMessages (integration)", () => {
  beforeEach(() => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) => {
      const client = new DatabaseClient(FIXTURE_PATH);
      try {
        return callback({ accountId: 1, db: client } as DatabaseContext);
      } finally {
        client.close();
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists conversations from the fixture database", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);

    const handler = getHandler("query-messages");
    const result = (await handler({ cdpPort: 9222 })) as {
      content: [{ type: string; text: string }];
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0].text) as {
      conversations: { id: number; participants: unknown[] }[];
    };
    expect(body.conversations.length).toBeGreaterThanOrEqual(3);
  });

  it("filters conversations by personId", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);

    const handler = getHandler("query-messages");
    // Person 1 (Ada) participates in chat 1, chat 2, and chat 4
    const result = (await handler({ personId: 1, cdpPort: 9222 })) as {
      content: [{ type: string; text: string }];
    };

    const body = JSON.parse(result.content[0].text) as {
      conversations: { id: number }[];
    };
    expect(body.conversations).toHaveLength(3);
    const chatIds = body.conversations.map((c) => c.id);
    expect(chatIds).toContain(1);
    expect(chatIds).toContain(2);
    expect(chatIds).toContain(4);
  });

  it("retrieves a conversation thread by chatId", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);

    const handler = getHandler("query-messages");
    const result = (await handler({ chatId: 1, cdpPort: 9222 })) as {
      content: [{ type: string; text: string }];
    };

    const body = JSON.parse(result.content[0].text) as {
      chat: { id: number; participants: { firstName: string }[] };
      messages: { text: string; senderFirstName: string; sendAt: string }[];
    };
    expect(body.chat.id).toBe(1);
    expect(body.chat.participants.length).toBeGreaterThanOrEqual(2);
    expect(body.messages.length).toBeGreaterThanOrEqual(3);

    // Messages should be in chronological order
    const sendTimes = body.messages.map((m) => m.sendAt);
    const sorted = [...sendTimes].sort();
    expect(sendTimes).toEqual(sorted);
  });

  it("searches messages by text", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);

    const handler = getHandler("query-messages");
    const result = (await handler({ search: "compiler", cdpPort: 9222 })) as {
      content: [{ type: string; text: string }];
    };

    const body = JSON.parse(result.content[0].text) as {
      messages: { text: string }[];
    };
    expect(body.messages.length).toBeGreaterThanOrEqual(1);
    for (const msg of body.messages) {
      expect(msg.text.toLowerCase()).toContain("compiler");
    }
  });

  it("returns error for nonexistent chatId", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);

    const handler = getHandler("query-messages");
    const result = (await handler({ chatId: 999, cdpPort: 9222 })) as {
      content: [{ type: string; text: string }];
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Chat not found.");
  });

  it("respects limit parameter", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);

    const handler = getHandler("query-messages");
    const result = (await handler({ limit: 1, cdpPort: 9222 })) as {
      content: [{ type: string; text: string }];
    };

    const body = JSON.parse(result.content[0].text) as {
      conversations: unknown[];
    };
    expect(body.conversations).toHaveLength(1);
  });
});
