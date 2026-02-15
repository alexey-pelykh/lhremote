// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    checkReplies: vi.fn(),
  };
});

import {
  type CheckRepliesOutput,
  type ConversationMessages,
  InstanceNotRunningError,
  checkReplies,
} from "@lhremote/core";

import { handleCheckReplies } from "./check-replies.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

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

const MOCK_RESULT: CheckRepliesOutput = {
  newMessages: MOCK_CONVERSATIONS,
  totalNew: 1,
  checkedAt: "2025-01-15T12:00:00Z",
};

describe("handleCheckReplies", () => {
  const originalExitCode = process.exitCode;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints JSON with --json", async () => {
    vi.mocked(checkReplies).mockResolvedValue(MOCK_RESULT);

    await handleCheckReplies({ json: true });

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.newMessages).toEqual(MOCK_CONVERSATIONS);
    expect(output.totalNew).toBe(1);
    expect(output.checkedAt).toBeDefined();
  });

  it("prints human-readable output by default", async () => {
    vi.mocked(checkReplies).mockResolvedValue(MOCK_RESULT);

    await handleCheckReplies({});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("1 new message found:");
    expect(output).toContain("Jane Doe (person #456, chat #123):");
    expect(output).toContain("Thanks for reaching out!");
  });

  it("prints progress to stderr", async () => {
    vi.mocked(checkReplies).mockResolvedValue(MOCK_RESULT);

    await handleCheckReplies({});

    const stderr = getStderr(stderrSpy);
    expect(stderr).toContain("Checking for new replies...");
    expect(stderr).toContain("Done.");
  });

  it("prints 'No new messages' when empty", async () => {
    vi.mocked(checkReplies).mockResolvedValue({
      newMessages: [],
      totalNew: 0,
      checkedAt: "2025-01-15T12:00:00Z",
    });

    await handleCheckReplies({});

    expect(getStdout(stdoutSpy)).toContain("No new messages found.");
  });

  it("passes since parameter when provided", async () => {
    vi.mocked(checkReplies).mockResolvedValue({
      newMessages: [],
      totalNew: 0,
      checkedAt: "2025-01-15T12:00:00Z",
    });

    await handleCheckReplies({ since: "2025-01-14T00:00:00Z" });

    expect(checkReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        since: "2025-01-14T00:00:00Z",
      }),
    );
  });

  it("sets exitCode on error", async () => {
    vi.mocked(checkReplies).mockRejectedValue(
      new Error("No accounts found."),
    );

    await handleCheckReplies({});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("No accounts found.");
  });

  it("sets exitCode when no instance running", async () => {
    vi.mocked(checkReplies).mockRejectedValue(
      new InstanceNotRunningError(
        "No LinkedHelper instance is running. Use start-instance first.",
      ),
    );

    await handleCheckReplies({});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain(
      "No LinkedHelper instance is running. Use start-instance first.",
    );
  });

  it("pluralizes message count correctly", async () => {
    vi.mocked(checkReplies).mockResolvedValue({
      newMessages: [
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
      ],
      totalNew: 2,
      checkedAt: "2025-01-15T12:00:00Z",
    });

    await handleCheckReplies({});

    expect(getStdout(stdoutSpy)).toContain("2 new messages found:");
  });
});
