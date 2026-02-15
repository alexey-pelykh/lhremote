// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

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
    queryMessages: vi.fn(),
  };
});

import {
  ChatNotFoundError,
  DatabaseClient,
  MessageRepository,
  queryMessages,
  type QueryMessagesInput,
} from "@lhremote/core";

import { registerQueryMessages } from "./query-messages.js";
import { createMockServer } from "./testing/mock-server.js";

/**
 * Run the real query-messages logic against the fixture DB.
 * This replaces the mock so the MCP tool handler exercises real DB queries.
 */
function fixtureQueryMessages(input: QueryMessagesInput) {
  const client = new DatabaseClient(FIXTURE_PATH);
  try {
    const repo = new MessageRepository(client);
    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;

    if (input.chatId != null) {
      const thread = repo.getThread(input.chatId, { limit });
      return { kind: "thread" as const, thread };
    }

    if (input.search != null) {
      const messages = repo.searchMessages(input.search, { limit });
      return { kind: "search" as const, messages, total: messages.length };
    }

    const conversations = repo.listChats({
      ...(input.personId != null && { personId: input.personId }),
      limit,
      offset,
    });
    return { kind: "conversations" as const, conversations, total: conversations.length };
  } finally {
    client.close();
  }
}

describe("registerQueryMessages (integration)", () => {
  beforeEach(() => {
    vi.mocked(queryMessages).mockImplementation(async (input) =>
      fixtureQueryMessages(input),
    );
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
    vi.mocked(queryMessages).mockRejectedValue(
      new ChatNotFoundError(999),
    );

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
