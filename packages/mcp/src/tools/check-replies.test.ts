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
  type ConversationMessages,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  InstanceNotRunningError,
  InstanceService,
  LauncherService,
  LinkedHelperNotRunningError,
  MessageRepository,
} from "@lhremote/core";

import { registerCheckReplies } from "./check-replies.js";
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

function mockRepo(conversations: ConversationMessages[] = MOCK_CONVERSATIONS) {
  vi.mocked(MessageRepository).mockImplementation(function () {
    return {
      getMessagesSince: vi.fn().mockReturnValue(conversations),
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

    mockLauncher();
    const executeAction = vi.fn().mockResolvedValue(undefined);
    mockInstance({ executeAction });
    mockDb();
    mockRepo();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("check-replies");
    await handler({ cdpPort: 9222 });

    expect(executeAction).toHaveBeenCalledWith("CheckForReplies");
  });

  it("uses since parameter when provided", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    mockLauncher();
    mockInstance();
    mockDb();
    const getMessagesSince = vi.fn().mockReturnValue([]);
    vi.mocked(MessageRepository).mockImplementation(function () {
      return { getMessagesSince } as unknown as MessageRepository;
    });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("check-replies");
    await handler({ since: "2025-01-14T00:00:00Z", cdpPort: 9222 });

    expect(getMessagesSince).toHaveBeenCalledWith("2025-01-14T00:00:00Z");
  });

  it("defaults to last 24 hours when since is omitted", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    mockLauncher();
    mockInstance();
    mockDb();
    const getMessagesSince = vi.fn().mockReturnValue([]);
    vi.mocked(MessageRepository).mockImplementation(function () {
      return { getMessagesSince } as unknown as MessageRepository;
    });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("check-replies");
    await handler({ cdpPort: 9222 });

    expect(getMessagesSince).toHaveBeenCalledWith("2025-01-14T12:00:00.000Z");
  });

  it("returns error when LinkedHelper not running", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("check-replies");
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

  it("returns error when no accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([]),
    });

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

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([
        { id: 1, liId: 1, name: "Alice" },
        { id: 2, liId: 2, name: "Bob" },
      ]),
    });

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

    mockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(null);

    const handler = getHandler("check-replies");
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
    registerCheckReplies(server);

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

    const handler = getHandler("check-replies");
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
    registerCheckReplies(server);

    mockLauncher();
    mockInstance({
      executeAction: vi.fn().mockRejectedValue(new Error("action timed out")),
    });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

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

  it("disconnects launcher after account lookup", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    const { disconnect: launcherDisconnect } = mockLauncher();
    mockInstance();
    mockDb();
    mockRepo();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("check-replies");
    await handler({ cdpPort: 9222 });

    expect(launcherDisconnect).toHaveBeenCalledOnce();
  });

  it("disconnects instance and closes db after success", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    const { close: dbClose } = mockDb();
    mockRepo();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("check-replies");
    await handler({ cdpPort: 9222 });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("disconnects instance after error", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance({
      executeAction: vi.fn().mockRejectedValue(new Error("test error")),
    });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    const handler = getHandler("check-replies");
    await handler({ cdpPort: 9222 });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
  });

  it("passes cdpPort to LauncherService and discoverInstancePort", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    setupSuccessPath();

    const handler = getHandler("check-replies");
    await handler({ cdpPort: 4567 });

    expect(LauncherService).toHaveBeenCalledWith(4567);
    expect(discoverInstancePort).toHaveBeenCalledWith(4567);
  });

  it("passes discovered port and timeout to InstanceService", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    setupSuccessPath();

    const handler = getHandler("check-replies");
    await handler({ cdpPort: 9222 });

    expect(InstanceService).toHaveBeenCalledWith(55123, { timeout: 120_000 });
  });

  it("returns empty results when no new messages", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    mockLauncher();
    mockInstance();
    mockDb();
    mockRepo([]);
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("check-replies");
    const result = await handler({ cdpPort: 9222 });

    const content = (result as { content: { text: string }[] }).content;
    expect(content[0]).toBeDefined();
    const parsed = JSON.parse(content[0]?.text ?? "");
    expect(parsed.newMessages).toEqual([]);
    expect(parsed.totalNew).toBe(0);
  });
});
