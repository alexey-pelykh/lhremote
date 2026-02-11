import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    resolveAccount: vi.fn(),
    withDatabase: vi.fn(),
    MessageRepository: vi.fn(),
  };
});

import {
  type Chat,
  type ConversationThread,
  type DatabaseContext,
  type Message,
  ChatNotFoundError,
  LinkedHelperNotRunningError,
  MessageRepository,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";

import { registerQueryMessages } from "./query-messages.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_CHAT: Chat = {
  id: 123,
  type: "MEMBER_TO_MEMBER",
  platform: "LINKEDIN",
  participants: [
    { personId: 456, firstName: "Jane", lastName: "Doe" },
  ],
  messageCount: 12,
  lastMessage: {
    text: "Thanks for reaching out!",
    sendAt: "2025-01-15T10:30:00Z",
  },
};

const MOCK_MESSAGE: Message = {
  id: 1,
  type: "DEFAULT",
  text: "Hi Jane, I saw your work on...",
  subject: null,
  sendAt: "2025-01-14T09:00:00Z",
  attachmentsCount: 0,
  senderPersonId: 789,
  senderFirstName: "Alexey",
  senderLastName: "Pelykh",
};

const MOCK_THREAD: ConversationThread = {
  chat: MOCK_CHAT,
  messages: [MOCK_MESSAGE],
};

function mockRepo(overrides?: {
  listChats?: Chat[];
  thread?: ConversationThread;
  searchMessages?: Message[];
}) {
  vi.mocked(MessageRepository).mockImplementation(function () {
    return {
      listChats: vi.fn().mockReturnValue(overrides?.listChats ?? [MOCK_CHAT]),
      getThread: vi.fn().mockReturnValue(overrides?.thread ?? MOCK_THREAD),
      searchMessages: vi
        .fn()
        .mockReturnValue(overrides?.searchMessages ?? [MOCK_MESSAGE]),
    } as unknown as MessageRepository;
  });
}

function mockRepoChatNotFound() {
  vi.mocked(MessageRepository).mockImplementation(function () {
    return {
      listChats: vi.fn().mockReturnValue([]),
      getThread: vi.fn().mockImplementation((chatId: number) => {
        throw new ChatNotFoundError(chatId);
      }),
      searchMessages: vi.fn().mockReturnValue([]),
    } as unknown as MessageRepository;
  });
}

function setupSuccessPath() {
  vi.mocked(resolveAccount).mockResolvedValue(1);
  vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
    callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
  );
  mockRepo();
}

describe("registerQueryMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named query-messages", () => {
    const { server } = createMockServer();
    registerQueryMessages(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "query-messages",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns conversations list when no filters provided", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);
    setupSuccessPath();

    const handler = getHandler("query-messages");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { conversations: [MOCK_CHAT], total: 1 },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("returns conversations filtered by personId", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);
    setupSuccessPath();

    const handler = getHandler("query-messages");
    const result = await handler({ personId: 456, cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { conversations: [MOCK_CHAT], total: 1 },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("returns conversation thread when chatId provided", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);
    setupSuccessPath();

    const handler = getHandler("query-messages");
    const result = await handler({ chatId: 123, cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(MOCK_THREAD, null, 2),
        },
      ],
    });
  });

  it("returns search results when search provided", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);
    setupSuccessPath();

    const handler = getHandler("query-messages");
    const result = await handler({ search: "reaching out", cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { messages: [MOCK_MESSAGE], total: 1 },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("returns error when chat not found", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
    );
    mockRepoChatNotFound();

    const handler = getHandler("query-messages");
    const result = await handler({ chatId: 999, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Chat not found.",
        },
      ],
    });
  });

  it("returns error on unexpected database failure", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
    );
    vi.mocked(MessageRepository).mockImplementation(function () {
      return {
        listChats: vi.fn().mockImplementation(() => {
          throw new Error("database locked");
        }),
      } as unknown as MessageRepository;
    });

    const handler = getHandler("query-messages");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to query messages: database locked",
        },
      ],
    });
  });

  it("returns error when LinkedHelper is not running", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);

    vi.mocked(resolveAccount).mockRejectedValue(
      new LinkedHelperNotRunningError(9222),
    );

    const handler = getHandler("query-messages");
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

  it("chatId takes priority over search and personId", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);
    setupSuccessPath();

    const handler = getHandler("query-messages");
    const result = await handler({
      chatId: 123,
      search: "hello",
      personId: 456,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(MOCK_THREAD, null, 2),
        },
      ],
    });
  });

  it("search takes priority over personId", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryMessages(server);
    setupSuccessPath();

    const handler = getHandler("query-messages");
    const result = await handler({
      search: "reaching out",
      personId: 456,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { messages: [MOCK_MESSAGE], total: 1 },
            null,
            2,
          ),
        },
      ],
    });
  });
});
