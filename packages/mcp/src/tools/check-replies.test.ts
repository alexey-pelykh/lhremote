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
  type ConversationMessages,
  AccountResolutionError,
  checkReplies,
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

describe("registerCheckReplies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
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

    vi.mocked(checkReplies).mockResolvedValue({
      newMessages: MOCK_CONVERSATIONS,
      totalNew: 3,
      checkedAt: "2025-01-15T12:00:00.000Z",
    });

    const handler = getHandler("check-replies");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              newMessages: MOCK_CONVERSATIONS,
              totalNew: 3,
              checkedAt: "2025-01-15T12:00:00.000Z",
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("passes correct arguments to operation", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    vi.mocked(checkReplies).mockResolvedValue({
      newMessages: [],
      totalNew: 0,
      checkedAt: "2025-01-15T12:00:00.000Z",
    });

    const handler = getHandler("check-replies");
    await handler({ since: "2025-01-14T00:00:00Z", cdpPort: 9222 });

    expect(checkReplies).toHaveBeenCalledWith(
      expect.objectContaining({ since: "2025-01-14T00:00:00Z", cdpPort: 9222 }),
    );
  });

  it("passes since as undefined when omitted", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    vi.mocked(checkReplies).mockResolvedValue({
      newMessages: [],
      totalNew: 0,
      checkedAt: "2025-01-15T12:00:00.000Z",
    });

    const handler = getHandler("check-replies");
    await handler({ cdpPort: 9222 });

    expect(checkReplies).toHaveBeenCalledWith(
      expect.objectContaining({ cdpPort: 9222 }),
    );
  });

  it("returns empty results when no new messages", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    vi.mocked(checkReplies).mockResolvedValue({
      newMessages: [],
      totalNew: 0,
      checkedAt: "2025-01-15T12:00:00.000Z",
    });

    const handler = getHandler("check-replies");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              newMessages: [],
              totalNew: 0,
              checkedAt: "2025-01-15T12:00:00.000Z",
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("returns error when no accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    vi.mocked(checkReplies).mockRejectedValue(
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

    vi.mocked(checkReplies).mockRejectedValue(
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

  it("returns error on unexpected failure", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckReplies(server);

    vi.mocked(checkReplies).mockRejectedValue(
      new Error("action timed out"),
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

  describeInfrastructureErrors(
    registerCheckReplies,
    "check-replies",
    () => ({ cdpPort: 9222 }),
    (error) => vi.mocked(checkReplies).mockRejectedValue(error),
    "Failed to check replies",
  );
});
