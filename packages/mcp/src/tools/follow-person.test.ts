// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    followPerson: vi.fn(),
  };
});

import {
  type EphemeralActionResult,
  followPerson,
} from "@lhremote/core";

import { registerFollowPerson } from "./follow-person.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { describeEphemeralActionErrors } from "./testing/ephemeral-action-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT: EphemeralActionResult = {
  success: true,
  personId: 100,
  results: [{ id: 1, actionVersionId: 1, personId: 100, result: 1, platform: null, createdAt: "2026-01-01T00:00:00Z", profile: null }],
};

describe("registerFollowPerson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named follow-person", () => {
    const { server } = createMockServer();
    registerFollowPerson(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "follow-person",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("follows person on success", async () => {
    const { server, getHandler } = createMockServer();
    registerFollowPerson(server);

    vi.mocked(followPerson).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("follow-person");
    const result = await handler({ personId: 100, cdpPort: 9222 });

    expect(followPerson).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 100, cdpPort: 9222 }),
    );
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("passes mode parameter", async () => {
    const { server, getHandler } = createMockServer();
    registerFollowPerson(server);

    vi.mocked(followPerson).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("follow-person");
    await handler({ personId: 100, mode: "unfollow", cdpPort: 9222 });

    expect(followPerson).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 100, mode: "unfollow" }),
    );
  });

  it("returns error when neither personId nor url provided", async () => {
    const { server, getHandler } = createMockServer();
    registerFollowPerson(server);

    const handler = getHandler("follow-person");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Exactly one of personId or url must be provided." }],
    });
  });

  describeInfrastructureErrors(
    registerFollowPerson,
    "follow-person",
    () => ({ personId: 100, cdpPort: 9222 }),
    (error) => vi.mocked(followPerson).mockRejectedValue(error),
    "Failed to follow person",
  );

  describeEphemeralActionErrors(
    registerFollowPerson,
    "follow-person",
    () => ({ personId: 100, cdpPort: 9222 }),
    (error) => vi.mocked(followPerson).mockRejectedValue(error),
    "Failed to follow person",
  );
});
