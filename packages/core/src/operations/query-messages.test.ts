// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withDatabase: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  MessageRepository: vi.fn(),
}));

import type { DatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { MessageRepository } from "../db/index.js";
import { queryMessages } from "./query-messages.js";

const MOCK_THREAD = {
  chat: { id: 5, type: "direct", platform: "linkedin", participants: [], messageCount: 2, lastMessage: null },
  messages: [
    { id: 1, type: "text", text: "hello", subject: null, sendAt: "2026-01-01T00:00:00Z", attachmentsCount: 0, senderPersonId: 100, senderFirstName: "Alice", senderLastName: null },
  ],
};

const MOCK_SEARCH_MESSAGES = [
  { id: 1, type: "text", text: "hello world", subject: null, sendAt: "2026-01-01T00:00:00Z", attachmentsCount: 0, senderPersonId: 100, senderFirstName: "Alice", senderLastName: null },
  { id: 2, type: "text", text: "hello there", subject: null, sendAt: "2026-01-01T00:01:00Z", attachmentsCount: 0, senderPersonId: 101, senderFirstName: "Bob", senderLastName: null },
];

const MOCK_CONVERSATIONS = [
  { id: 5, type: "direct", platform: "linkedin", participants: [], messageCount: 3, lastMessage: null },
];

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(MessageRepository).mockImplementation(function () {
    return {
      getThread: vi.fn().mockReturnValue(MOCK_THREAD),
      searchMessages: vi.fn().mockReturnValue(MOCK_SEARCH_MESSAGES),
      listChats: vi.fn().mockReturnValue(MOCK_CONVERSATIONS),
    } as unknown as MessageRepository;
  });
}

describe("queryMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns thread mode when chatId is provided", async () => {
    setupMocks();

    const result = await queryMessages({
      chatId: 5,
      cdpPort: 9222,
    });

    expect(result.kind).toBe("thread");
    if (result.kind === "thread") {
      expect(result.thread).toBe(MOCK_THREAD);
    }
  });

  it("returns search mode when search is provided", async () => {
    setupMocks();

    const result = await queryMessages({
      search: "hello",
      cdpPort: 9222,
    });

    expect(result.kind).toBe("search");
    if (result.kind === "search") {
      expect(result.messages).toBe(MOCK_SEARCH_MESSAGES);
      expect(result.total).toBe(2);
    }
  });

  it("returns conversations mode when neither chatId nor search is provided", async () => {
    setupMocks();

    const result = await queryMessages({
      cdpPort: 9222,
    });

    expect(result.kind).toBe("conversations");
    if (result.kind === "conversations") {
      expect(result.conversations).toBe(MOCK_CONVERSATIONS);
      expect(result.total).toBe(1);
    }
  });

  it("prefers chatId over search when both are provided", async () => {
    setupMocks();

    const result = await queryMessages({
      chatId: 5,
      search: "hello",
      cdpPort: 9222,
    });

    expect(result.kind).toBe("thread");
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await queryMessages({
      cdpPort: 1234,
      cdpHost: "192.168.1.1",
      allowRemote: true,
    });

    expect(resolveAccount).toHaveBeenCalledWith(1234, {
      host: "192.168.1.1",
      allowRemote: true,
    });
  });

  it("omits undefined connection options", async () => {
    setupMocks();

    await queryMessages({
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      queryMessages({ cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockRejectedValue(
      new Error("database not found"),
    );

    await expect(
      queryMessages({ cdpPort: 9222 }),
    ).rejects.toThrow("database not found");
  });

  it("propagates MessageRepository errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(
      async (_accountId, callback) =>
        callback({ db: {} } as unknown as DatabaseContext),
    );
    vi.mocked(MessageRepository).mockImplementation(function () {
      return {
        getThread: vi.fn().mockImplementation(() => {
          throw new Error("chat not found");
        }),
        searchMessages: vi.fn(),
        listChats: vi.fn(),
      } as unknown as MessageRepository;
    });

    await expect(
      queryMessages({ chatId: 999, cdpPort: 9222 }),
    ).rejects.toThrow("chat not found");
  });
});
