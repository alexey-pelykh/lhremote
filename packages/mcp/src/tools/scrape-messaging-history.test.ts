import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    LauncherService: vi.fn(),
    InstanceService: vi.fn(),
    DatabaseClient: vi.fn(),
    MessageRepository: vi.fn(),
    discoverInstancePort: vi.fn(),
    discoverDatabase: vi.fn(),
  };
});

import {
  type Account,
  type MessageStats,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  InstanceNotRunningError,
  InstanceService,
  LauncherService,
  LinkedHelperNotRunningError,
  MessageRepository,
} from "@lhremote/core";

import { registerScrapeMessagingHistory } from "./scrape-messaging-history.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_STATS: MessageStats = {
  totalMessages: 2500,
  totalChats: 150,
  earliestMessage: "2024-01-15T09:00:00Z",
  latestMessage: "2025-01-15T12:00:00Z",
};

function mockLauncher(overrides: Record<string, unknown> = {}) {
  const disconnect = vi.fn();
  vi.mocked(LauncherService).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      listAccounts: vi
        .fn()
        .mockResolvedValue([{ id: 1, liId: 1, name: "Alice" } as Account]),
      ...overrides,
    } as unknown as LauncherService;
  });
  return { disconnect };
}

function mockInstance(overrides: Record<string, unknown> = {}) {
  const disconnect = vi.fn();
  vi.mocked(InstanceService).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      executeAction: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as InstanceService;
  });
  return { disconnect };
}

function mockDb() {
  const close = vi.fn();
  vi.mocked(DatabaseClient).mockImplementation(function () {
    return { close, db: {} } as unknown as DatabaseClient;
  });
  return { close };
}

function mockRepo(stats: MessageStats = MOCK_STATS) {
  vi.mocked(MessageRepository).mockImplementation(function () {
    return {
      getMessageStats: vi.fn().mockReturnValue(stats),
    } as unknown as MessageRepository;
  });
}

function setupSuccessPath() {
  mockLauncher();
  mockInstance();
  mockDb();
  mockRepo();
  vi.mocked(discoverInstancePort).mockResolvedValue(55123);
  vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
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

    mockLauncher();
    const executeAction = vi.fn().mockResolvedValue(undefined);
    mockInstance({ executeAction });
    mockDb();
    mockRepo();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("scrape-messaging-history");
    await handler({ cdpPort: 9222 });

    expect(executeAction).toHaveBeenCalledWith("ScrapeMessagingHistory");
  });

  it("returns error when LinkedHelper not running", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("scrape-messaging-history");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "LinkedHelper is not running. Use launch-app first.",
        },
      ],
    });
  });

  it("returns error when launcher connect fails with unknown error", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("scrape-messaging-history");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to connect to LinkedHelper: connection refused",
        },
      ],
    });
  });

  it("returns error when no accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([]),
    });

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

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([
        { id: 1, liId: 1, name: "Alice" },
        { id: 2, liId: 2, name: "Bob" },
      ]),
    });

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

    mockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(null);

    const handler = getHandler("scrape-messaging-history");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "No LinkedHelper instance is running. Use start-instance first.",
        },
      ],
    });
  });

  it("returns error when instance connect fails", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    mockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(InstanceService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(
            new InstanceNotRunningError("LinkedIn webview target not found"),
          ),
        disconnect: vi.fn(),
      } as unknown as InstanceService;
    });

    const handler = getHandler("scrape-messaging-history");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "No LinkedHelper instance is running. Use start-instance first.",
        },
      ],
    });
  });

  it("returns error on action execution failure", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    mockLauncher();
    mockInstance({
      executeAction: vi.fn().mockRejectedValue(new Error("action timed out")),
    });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

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

  it("disconnects launcher after account lookup", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    const { disconnect: launcherDisconnect } = mockLauncher();
    mockInstance();
    mockDb();
    mockRepo();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("scrape-messaging-history");
    await handler({ cdpPort: 9222 });

    expect(launcherDisconnect).toHaveBeenCalledOnce();
  });

  it("disconnects instance and closes db after success", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    const { close: dbClose } = mockDb();
    mockRepo();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("scrape-messaging-history");
    await handler({ cdpPort: 9222 });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("disconnects instance after error", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance({
      executeAction: vi.fn().mockRejectedValue(new Error("test error")),
    });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    const handler = getHandler("scrape-messaging-history");
    await handler({ cdpPort: 9222 });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
  });

  it("passes cdpPort to LauncherService and discoverInstancePort", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    setupSuccessPath();

    const handler = getHandler("scrape-messaging-history");
    await handler({ cdpPort: 4567 });

    expect(LauncherService).toHaveBeenCalledWith(4567);
    expect(discoverInstancePort).toHaveBeenCalledWith(4567);
  });

  it("passes discovered port and timeout to InstanceService", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    setupSuccessPath();

    const handler = getHandler("scrape-messaging-history");
    await handler({ cdpPort: 9222 });

    expect(InstanceService).toHaveBeenCalledWith(55123, { timeout: 300_000 });
  });

  it("discovers database for the account", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    setupSuccessPath();

    const handler = getHandler("scrape-messaging-history");
    await handler({ cdpPort: 9222 });

    expect(discoverDatabase).toHaveBeenCalledWith(1);
  });
});
