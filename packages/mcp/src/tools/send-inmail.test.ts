// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    sendInmail: vi.fn(),
  };
});

import {
  type EphemeralActionResult,
  sendInmail,
} from "@lhremote/core";

import { registerSendInmail } from "./send-inmail.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { describeEphemeralActionErrors } from "./testing/ephemeral-action-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT: EphemeralActionResult = {
  success: true,
  personId: 100,
  results: [{ id: 1, actionVersionId: 1, personId: 100, result: 1, platform: null, createdAt: "2026-01-01T00:00:00Z", profile: null }],
};

describe("registerSendInmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named send-inmail", () => {
    const { server } = createMockServer();
    registerSendInmail(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "send-inmail",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("sends InMail on success with personId", async () => {
    const { server, getHandler } = createMockServer();
    registerSendInmail(server);

    vi.mocked(sendInmail).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("send-inmail");
    const result = await handler({
      personId: 100,
      messageTemplate: '{"type":"text","value":"Hello"}',
      cdpPort: 9222,
    });

    expect(sendInmail).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 100,
        messageTemplate: { type: "text", value: "Hello" },
      }),
    );
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("returns error when neither personId nor url provided", async () => {
    const { server, getHandler } = createMockServer();
    registerSendInmail(server);

    const handler = getHandler("send-inmail");
    const result = await handler({
      messageTemplate: '{"type":"text","value":"Hi"}',
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Exactly one of personId or url must be provided." }],
    });
  });

  it("returns error on invalid messageTemplate JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerSendInmail(server);

    const handler = getHandler("send-inmail");
    const result = await handler({
      personId: 100,
      messageTemplate: "not-json",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Invalid JSON in messageTemplate." }],
    });
  });

  describeInfrastructureErrors(
    registerSendInmail,
    "send-inmail",
    () => ({ personId: 100, messageTemplate: '{"type":"text","value":"Hi"}', cdpPort: 9222 }),
    (error) => vi.mocked(sendInmail).mockRejectedValue(error),
    "Failed to send InMail",
  );

  describeEphemeralActionErrors(
    registerSendInmail,
    "send-inmail",
    () => ({ personId: 100, messageTemplate: '{"type":"text","value":"Hi"}', cdpPort: 9222 }),
    (error) => vi.mocked(sendInmail).mockRejectedValue(error),
    "Failed to send InMail",
  );
});
