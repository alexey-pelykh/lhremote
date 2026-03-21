// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    sendInvite: vi.fn(),
  };
});

import {
  type EphemeralActionResult,
  sendInvite,
} from "@lhremote/core";

import { registerSendInvite } from "./send-invite.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { describeEphemeralActionErrors } from "./testing/ephemeral-action-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT: EphemeralActionResult = {
  success: true,
  personId: 100,
  results: [{ id: 1, actionVersionId: 1, personId: 100, result: 1, platform: null, createdAt: "2026-01-01T00:00:00Z", profile: null }],
};

describe("registerSendInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named send-invite", () => {
    const { server } = createMockServer();
    registerSendInvite(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "send-invite",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("sends invite on success with personId", async () => {
    const { server, getHandler } = createMockServer();
    registerSendInvite(server);

    vi.mocked(sendInvite).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("send-invite");
    const result = await handler({ personId: 100, cdpPort: 9222 });

    expect(sendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 100, cdpPort: 9222 }),
    );
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("sends invite with url", async () => {
    const { server, getHandler } = createMockServer();
    registerSendInvite(server);

    vi.mocked(sendInvite).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("send-invite");
    await handler({ url: "https://www.linkedin.com/in/jane-doe", cdpPort: 9222 });

    expect(sendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://www.linkedin.com/in/jane-doe" }),
    );
  });

  it("returns error when neither personId nor url provided", async () => {
    const { server, getHandler } = createMockServer();
    registerSendInvite(server);

    const handler = getHandler("send-invite");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Exactly one of personId or url must be provided." }],
    });
  });

  it("returns error on invalid messageTemplate JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerSendInvite(server);

    const handler = getHandler("send-invite");
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
    registerSendInvite,
    "send-invite",
    () => ({ personId: 100, cdpPort: 9222 }),
    (error) => vi.mocked(sendInvite).mockRejectedValue(error),
    "Failed to send invite",
  );

  describeEphemeralActionErrors(
    registerSendInvite,
    "send-invite",
    () => ({ personId: 100, cdpPort: 9222 }),
    (error) => vi.mocked(sendInvite).mockRejectedValue(error),
    "Failed to send invite",
  );
});
