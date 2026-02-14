// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

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
  type InstanceDatabaseContext,
  type MessageStats,
  AccountResolutionError,
  InstanceNotRunningError,
  MessageRepository,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

import { registerScrapeMessagingHistory } from "./scrape-messaging-history.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_STATS: MessageStats = {
  totalMessages: 2500,
  totalChats: 150,
  earliestMessage: "2024-01-15T09:00:00Z",
  latestMessage: "2025-01-15T12:00:00Z",
};

function mockRepo(stats: MessageStats = MOCK_STATS) {
  vi.mocked(MessageRepository).mockImplementation(function () {
    return {
      getMessageStats: vi.fn().mockReturnValue(stats),
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

describe("registerScrapeMessagingHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named scrape-messaging-history", () => {
    const { server } = createMockServer();
    registerScrapeMessagingHistory(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "scrape-messaging-history",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns stats on success", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);
    setupSuccessPath();

    const handler = getHandler("scrape-messaging-history");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              actionType: "ScrapeMessagingHistory",
              stats: MOCK_STATS,
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("executes ScrapeMessagingHistory action", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

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

    const handler = getHandler("scrape-messaging-history");
    await handler({ cdpPort: 9222 });

    expect(executeAction).toHaveBeenCalledWith("ScrapeMessagingHistory");
  });

  describeInfrastructureErrors(
    registerScrapeMessagingHistory,
    "scrape-messaging-history",
    () => ({ cdpPort: 9222 }),
    "Failed to connect to LinkedHelper",
  );

  it("returns error when no accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    vi.mocked(resolveAccount).mockRejectedValue(
      new AccountResolutionError("no-accounts"),
    );

    const handler = getHandler("scrape-messaging-history");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "No accounts found." }],
    });
  });

  it("returns error when multiple accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    vi.mocked(resolveAccount).mockRejectedValue(
      new AccountResolutionError("multiple-accounts"),
    );

    const handler = getHandler("scrape-messaging-history");
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
    registerScrapeMessagingHistory(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new InstanceNotRunningError("Instance not running"),
    );

    const handler = getHandler("scrape-messaging-history");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to scrape messaging history: Instance not running",
        },
      ],
    });
  });

  it("returns error on action execution failure", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

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

    const handler = getHandler("scrape-messaging-history");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to scrape messaging history: action timed out",
        },
      ],
    });
  });
});
