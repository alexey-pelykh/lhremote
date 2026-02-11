import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    DatabaseClient: vi.fn(),
    MessageRepository: vi.fn(),
    discoverAllDatabases: vi.fn(),
  };
});

import {
  type Chat,
  type ConversationThread,
  type Message,
  ChatNotFoundError,
  MessageRepository,
} from "@lhremote/core";

import { handleQueryMessages } from "./query-messages.js";
import { mockDb, mockDiscovery } from "./testing/mock-helpers.js";

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
  mockDiscovery();
  mockDb();
  mockRepo();
}

describe("handleQueryMessages", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("sets exitCode 1 when no databases found", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockDiscovery(new Map());

    await handleQueryMessages({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper databases found.\n",
    );
  });

  it("prints JSON conversation list with --json", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryMessages({ json: true });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    expect(JSON.parse(output)).toEqual({
      conversations: [MOCK_CHAT],
      total: 1,
    });
  });

  it("prints human-friendly conversation list", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryMessages({});

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith("Conversations (1):\n");
    expect(stdoutSpy).toHaveBeenCalledWith(
      "\n#123 with Jane Doe (12 messages)\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      '  Last: "Thanks for reaching out!" — 2025-01-15\n',
    );
  });

  it("prints JSON thread with --json and --chat-id", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryMessages({ chatId: 123, json: true });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    expect(JSON.parse(output)).toEqual(MOCK_THREAD);
  });

  it("prints human-friendly thread with --chat-id", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryMessages({ chatId: 123 });

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith(
      "Conversation #123 with Jane Doe (12 messages):\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      "\n[2025-01-14 09:00] Alexey Pelykh:\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      "  Hi Jane, I saw your work on...\n",
    );
  });

  it("prints JSON search results with --json and --search", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryMessages({ search: "reaching out", json: true });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    expect(JSON.parse(output)).toEqual({
      messages: [MOCK_MESSAGE],
      total: 1,
    });
  });

  it("prints human-friendly search results with --search", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryMessages({ search: "reaching out" });

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith(
      'Messages matching "reaching out" (1):\n',
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      "\n[2025-01-14 09:00] Alexey Pelykh:\n",
    );
  });

  it("prints no conversations message when empty", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockDiscovery();
    mockDb();
    mockRepo({ listChats: [] });

    await handleQueryMessages({});

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith("No conversations found.\n");
  });

  it("prints no messages message when search yields nothing", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockDiscovery();
    mockDb();
    mockRepo({ searchMessages: [] });

    await handleQueryMessages({ search: "nonexistent" });

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith(
      'No messages matching "nonexistent".\n',
    );
  });

  it("sets exitCode 1 when chat not found", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockDiscovery();
    mockDb();
    mockRepoChatNotFound();

    await handleQueryMessages({ chatId: 999 });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Chat not found.\n");
  });

  it("closes database after successful query", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    mockDiscovery();
    const { close } = mockDb();
    mockRepo();

    await handleQueryMessages({});

    expect(close).toHaveBeenCalledOnce();
  });

  it("closes database after failed lookup", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    mockDiscovery();
    const { close } = mockDb();
    mockRepoChatNotFound();

    await handleQueryMessages({ chatId: 999 });

    expect(close).toHaveBeenCalledOnce();
  });

  it("sets exitCode 1 on unexpected database error", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockDiscovery();
    mockDb();
    vi.mocked(MessageRepository).mockImplementation(function () {
      return {
        listChats: vi.fn().mockImplementation(() => {
          throw new Error("database locked");
        }),
      } as unknown as MessageRepository;
    });

    await handleQueryMessages({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("database locked\n");
  });
});
