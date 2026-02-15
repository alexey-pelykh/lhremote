// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    resolveAccount: vi.fn(),
    withInstanceDatabase: vi.fn(),
    MessageRepository: vi.fn(),
  };
});

import {
  type ConversationMessages,
  type InstanceDatabaseContext,
  MessageRepository,
  AccountResolutionError,
  InstanceNotRunningError,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

import { registerCheckReplies } from "./check-replies.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_CONVERSATIONS: ConversationMessages[] = [
  {
    chatId: 123,
    personId: 456,
    personName: "Jane Doe",
    messages: [
      {
        id: 789,
        type: "MEMBER_TO_MEMBER",
        text: "Thanks for reaching out!",
        subject: null,
        sendAt: "2025-01-15T10:30:00Z",
        attachmentsCount: 0,
        senderPersonId: 456,
        senderFirstName: "Jane",
        senderLastName: "Doe",
      },
    ],
  },
  {
    chatId: 124,
    personId: 790,
    personName: "John Smith",
    messages: [
      {
        id: 791,
        type: "MEMBER_TO_MEMBER",
        text: "Let's schedule a call",
        subject: null,
        sendAt: "2025-01-15T11:00:00Z",
        attachmentsCount: 0,
        senderPersonId: 790,
        senderFirstName: "John",
        senderLastName: "Smith",
      },
      {
        id: 792,
        type: "MEMBER_TO_MEMBER",
        text: "How about Thursday?",
        subject: null,
        sendAt: "2025-01-15T11:05:00Z",
        attachmentsCount: 0,
        senderPersonId: 790,
        senderFirstName: "John",
        senderLastName: "Smith",
      },
    ],
  },
];

function mockRepo(conversations: ConversationMessages[] = MOCK_CONVERSATIONS) {
  vi.mocked(MessageRepository).mockImplementation(function () {
    return {
      getMessagesSince: vi.fn().mockReturnValue(conversations),
    } as unknown as MessageRepository;
  });
}

function setupSuccessPath() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  const mockInstance = { executeAction: vi.fn().mockResolvedValue(undefined) };
  vi.mocked(withInstanceDatabase).mockImplementation(
    async (_cdpPort, _accountId, callback) =>
      callback({
        accountId: 1,
        instance: mockInstance,
        db: {},
      } as unknown as InstanceDatabaseContext),
  );
  mockRepo();
}

describe("registerCheckReplies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("registers a tool named check-replies", () => {
    const { server } = createMockServer();
    registerCheckReplies(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "check-replies",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns new messages on success", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);
    setupSuccessPath();

    const handler = getHandler("check-replies");
    const result = await handler({ cdpPort: 9222 });

    const content = (result as { content: { text: string }[] }).content;
    expect(content[0]).toBeDefined();
    const parsed = JSON.parse(content[0]?.text ?? "");
    expect(parsed.newMessages).toEqual(MOCK_CONVERSATIONS);
    expect(parsed.totalNew).toBe(3);
    expect(parsed.checkedAt).toBeDefined();
  });

  it("executes CheckForReplies action", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    const executeAction = vi.fn().mockResolvedValue(undefined);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: { executeAction },
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
    mockRepo();

    const handler = getHandler("check-replies");
    await handler({ cdpPort: 9222 });

    expect(executeAction).toHaveBeenCalledWith("CheckForReplies");
  });

  it("uses since parameter when provided", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: { executeAction: vi.fn().mockResolvedValue(undefined) },
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
    const getMessagesSince = vi.fn().mockReturnValue([]);
    vi.mocked(MessageRepository).mockImplementation(function () {
      return { getMessagesSince } as unknown as MessageRepository;
    });

    const handler = getHandler("check-replies");
    await handler({ since: "2025-01-14T00:00:00Z", cdpPort: 9222 });

    expect(getMessagesSince).toHaveBeenCalledWith("2025-01-14T00:00:00Z");
  });

  it("defaults to last 24 hours when since is omitted", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: { executeAction: vi.fn().mockResolvedValue(undefined) },
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
    const getMessagesSince = vi.fn().mockReturnValue([]);
    vi.mocked(MessageRepository).mockImplementation(function () {
      return { getMessagesSince } as unknown as MessageRepository;
    });

    const handler = getHandler("check-replies");
    await handler({ cdpPort: 9222 });

    expect(getMessagesSince).toHaveBeenCalledWith("2025-01-14T12:00:00.000Z");
  });

  describeInfrastructureErrors(
    registerCheckReplies,
    "check-replies",
    () => ({ cdpPort: 9222 }),
  );

  it("returns error when no accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    vi.mocked(resolveAccount).mockRejectedValue(
      new AccountResolutionError("no-accounts"),
    );

    const handler = getHandler("check-replies");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "No accounts found." }],
    });
  });

  it("returns error when multiple accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    vi.mocked(resolveAccount).mockRejectedValue(
      new AccountResolutionError("multiple-accounts"),
    );

    const handler = getHandler("check-replies");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Multiple accounts found. Cannot determine which instance to use.",
        },
      ],
    });
  });

  it("returns error when no instance is running", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new InstanceNotRunningError("Instance not running"),
    );

    const handler = getHandler("check-replies");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to check replies: Instance not running",
        },
      ],
    });
  });

  it("returns error on action execution failure", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: {
            executeAction: vi.fn().mockRejectedValue(new Error("action timed out")),
          },
          db: {},
        } as unknown as InstanceDatabaseContext),
    );

    const handler = getHandler("check-replies");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to check replies: action timed out",
        },
      ],
    });
  });

  it("returns empty results when no new messages", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: { executeAction: vi.fn().mockResolvedValue(undefined) },
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
    mockRepo([]);

    const handler = getHandler("check-replies");
    const result = await handler({ cdpPort: 9222 });

    const content = (result as { content: { text: string }[] }).content;
    expect(content[0]).toBeDefined();
    const parsed = JSON.parse(content[0]?.text ?? "");
    expect(parsed.newMessages).toEqual([]);
    expect(parsed.totalNew).toBe(0);
  });
});
