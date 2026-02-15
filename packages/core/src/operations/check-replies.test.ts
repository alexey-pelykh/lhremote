// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withInstanceDatabase: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  MessageRepository: vi.fn(),
}));

import type { InstanceDatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { MessageRepository } from "../db/index.js";
import { checkReplies } from "./check-replies.js";

const MOCK_CONVERSATIONS = [
  {
    chatId: 5,
    personId: 100,
    personName: "Alice",
    messages: [
      { id: 1, type: "text", text: "hello", subject: null, sendAt: "2026-01-01T00:00:00Z", attachmentsCount: 0, senderPersonId: 100, senderFirstName: "Alice", senderLastName: null },
      { id: 2, type: "text", text: "how are you?", subject: null, sendAt: "2026-01-01T00:01:00Z", attachmentsCount: 0, senderPersonId: 100, senderFirstName: "Alice", senderLastName: null },
    ],
  },
];

const mockInstance = { executeAction: vi.fn().mockResolvedValue(undefined) };

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withInstanceDatabase).mockImplementation(
    async (_cdpPort, _accountId, callback) =>
      callback({
        accountId: 1,
        instance: mockInstance,
        db: {},
      } as unknown as InstanceDatabaseContext),
  );

  vi.mocked(MessageRepository).mockImplementation(function () {
    return {
      getMessagesSince: vi.fn().mockReturnValue(MOCK_CONVERSATIONS),
    } as unknown as MessageRepository;
  });
}

describe("checkReplies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns new messages and totals", async () => {
    setupMocks();

    const result = await checkReplies({
      cdpPort: 9222,
      since: "2025-12-31T00:00:00Z",
    });

    expect(result.newMessages).toBe(MOCK_CONVERSATIONS);
    expect(result.totalNew).toBe(2);
    expect(result.checkedAt).toBeDefined();
  });

  it("calls instance.executeAction with CheckForReplies", async () => {
    setupMocks();

    await checkReplies({
      cdpPort: 9222,
    });

    expect(mockInstance.executeAction).toHaveBeenCalledWith("CheckForReplies");
  });

  it("passes instanceTimeout to withInstanceDatabase", async () => {
    setupMocks();

    await checkReplies({
      cdpPort: 9222,
    });

    expect(withInstanceDatabase).toHaveBeenCalledWith(
      9222,
      1,
      expect.any(Function),
      { instanceTimeout: 120_000 },
    );
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await checkReplies({
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

    await checkReplies({
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      checkReplies({ cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withInstanceDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new Error("instance not running"),
    );

    await expect(
      checkReplies({ cdpPort: 9222 }),
    ).rejects.toThrow("instance not running");
  });

  it("propagates MessageRepository errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: mockInstance,
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
    vi.mocked(MessageRepository).mockImplementation(function () {
      return {
        getMessagesSince: vi.fn().mockImplementation(() => {
          throw new Error("query failed");
        }),
      } as unknown as MessageRepository;
    });

    await expect(
      checkReplies({ cdpPort: 9222 }),
    ).rejects.toThrow("query failed");
  });
});
