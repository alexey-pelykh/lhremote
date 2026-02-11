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
  InstanceNotRunningError,
  MessageRepository,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

import { handleCheckReplies } from "./check-replies.js";
import {
  mockResolveAccount,
  mockWithInstanceDatabase,
} from "./testing/mock-helpers.js";

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
];

function mockResolveAccountError(error: Error) {
  vi.mocked(resolveAccount).mockRejectedValue(error);
}

function mockRepo(conversations: ConversationMessages[] = MOCK_CONVERSATIONS) {
  vi.mocked(MessageRepository).mockImplementation(function () {
    return {
      getMessagesSince: vi.fn().mockReturnValue(conversations),
    } as unknown as MessageRepository;
  });
}

function mockInstanceWithRepo(
  conversations: ConversationMessages[] = MOCK_CONVERSATIONS,
) {
  mockRepo(conversations);
  mockWithInstanceDatabase();
}

function setupSuccessPath() {
  mockResolveAccount();
  mockInstanceWithRepo();
}

describe("handleCheckReplies", () => {
  const originalExitCode = process.exitCode;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function getStdout(): string {
    return stdoutSpy.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join("");
  }

  function getStderr(): string {
    return stderrSpy.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join("");
  }

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleCheckReplies({ json: true });

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout());
    expect(output.newMessages).toEqual(MOCK_CONVERSATIONS);
    expect(output.totalNew).toBe(1);
    expect(output.checkedAt).toBeDefined();
  });

  it("prints human-readable output by default", async () => {
    setupSuccessPath();

    await handleCheckReplies({});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("1 new message found:");
    expect(output).toContain("Jane Doe (person #456, chat #123):");
    expect(output).toContain("Thanks for reaching out!");
  });

  it("prints progress to stderr", async () => {
    setupSuccessPath();

    await handleCheckReplies({});

    const stderr = getStderr();
    expect(stderr).toContain("Checking for new replies...");
    expect(stderr).toContain("Done.");
  });

  it("prints 'No new messages' when empty", async () => {
    mockResolveAccount();
    mockInstanceWithRepo([]);

    await handleCheckReplies({});

    expect(getStdout()).toContain("No new messages found.");
  });

  it("uses since parameter when provided", async () => {
    mockResolveAccount();
    const getMessagesSince = vi.fn().mockReturnValue([]);
    vi.mocked(MessageRepository).mockImplementation(function () {
      return { getMessagesSince } as unknown as MessageRepository;
    });
    mockWithInstanceDatabase();

    await handleCheckReplies({ since: "2025-01-14T00:00:00Z" });

    expect(getMessagesSince).toHaveBeenCalledWith("2025-01-14T00:00:00Z");
  });

  it("defaults to last 24 hours when since is omitted", async () => {
    mockResolveAccount();
    const getMessagesSince = vi.fn().mockReturnValue([]);
    vi.mocked(MessageRepository).mockImplementation(function () {
      return { getMessagesSince } as unknown as MessageRepository;
    });
    mockWithInstanceDatabase();

    await handleCheckReplies({});

    expect(getMessagesSince).toHaveBeenCalledWith("2025-01-14T12:00:00.000Z");
  });

  it("sets exitCode on error", async () => {
    mockResolveAccountError(new Error("No accounts found."));

    await handleCheckReplies({});

    expect(process.exitCode).toBe(1);
    expect(getStderr()).toContain("No accounts found.");
  });

  it("sets exitCode when no instance running", async () => {
    mockResolveAccount();
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new InstanceNotRunningError(
        "No LinkedHelper instance is running. Use start-instance first.",
      ),
    );

    await handleCheckReplies({});

    expect(process.exitCode).toBe(1);
    expect(getStderr()).toContain(
      "No LinkedHelper instance is running. Use start-instance first.",
    );
  });

  it("pluralizes message count correctly", async () => {
    mockResolveAccount();
    mockInstanceWithRepo([
      {
        chatId: 1,
        personId: 1,
        personName: "Alice",
        messages: [
          {
            id: 1, type: "DEFAULT", text: "msg1", subject: null,
            sendAt: "2025-01-15T10:00:00Z", attachmentsCount: 0,
            senderPersonId: 1, senderFirstName: "Alice", senderLastName: null,
          },
          {
            id: 2, type: "DEFAULT", text: "msg2", subject: null,
            sendAt: "2025-01-15T10:05:00Z", attachmentsCount: 0,
            senderPersonId: 1, senderFirstName: "Alice", senderLastName: null,
          },
        ],
      },
    ]);

    await handleCheckReplies({});

    expect(getStdout()).toContain("2 new messages found:");
  });
});
