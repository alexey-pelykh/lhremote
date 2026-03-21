// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    likePersonPosts: vi.fn(),
  };
});

import {
  type EphemeralActionResult,
  likePersonPosts,
} from "@lhremote/core";

import { registerLikePersonPosts } from "./like-person-posts.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { describeEphemeralActionErrors } from "./testing/ephemeral-action-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT: EphemeralActionResult = {
  success: true,
  personId: 100,
  results: [{ id: 1, actionVersionId: 1, personId: 100, result: 1, platform: null, createdAt: "2026-01-01T00:00:00Z", profile: null }],
};

describe("registerLikePersonPosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named like-person-posts", () => {
    const { server } = createMockServer();
    registerLikePersonPosts(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "like-person-posts",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("likes person posts on success", async () => {
    const { server, getHandler } = createMockServer();
    registerLikePersonPosts(server);

    vi.mocked(likePersonPosts).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("like-person-posts");
    const result = await handler({ personId: 100, numberOfPosts: 3, cdpPort: 9222 });

    expect(likePersonPosts).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 100, numberOfPosts: 3, cdpPort: 9222 }),
    );
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("returns error when neither personId nor url provided", async () => {
    const { server, getHandler } = createMockServer();
    registerLikePersonPosts(server);

    const handler = getHandler("like-person-posts");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Exactly one of personId or url must be provided." }],
    });
  });

  it("returns error on invalid messageTemplate JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerLikePersonPosts(server);

    const handler = getHandler("like-person-posts");
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
    registerLikePersonPosts,
    "like-person-posts",
    () => ({ personId: 100, cdpPort: 9222 }),
    (error) => vi.mocked(likePersonPosts).mockRejectedValue(error),
    "Failed to like person posts",
  );

  describeEphemeralActionErrors(
    registerLikePersonPosts,
    "like-person-posts",
    () => ({ personId: 100, cdpPort: 9222 }),
    (error) => vi.mocked(likePersonPosts).mockRejectedValue(error),
    "Failed to like person posts",
  );
});
