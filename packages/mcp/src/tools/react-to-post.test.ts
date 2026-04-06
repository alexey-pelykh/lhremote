// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, reactToPost: vi.fn() };
});

import { reactToPost } from "@lhremote/core";
import { registerReactToPost } from "./react-to-post.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT = {
  success: true as const,
  postUrl:
    "https://www.linkedin.com/feed/update/urn:li:activity:123/",
  reactionType: "like" as const,
  alreadyReacted: false as const,
};

describe("registerReactToPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named react-to-post", () => {
    const { server } = createMockServer();
    registerReactToPost(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "react-to-post",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns result as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerReactToPost(server);
    vi.mocked(reactToPost).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("react-to-post");
    const result = await handler({
      postUrl:
        "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      reactionType: "like",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerReactToPost(server);
    vi.mocked(reactToPost).mockRejectedValue(
      new Error("connection refused"),
    );

    const handler = getHandler("react-to-post");
    const result = (await handler({
      postUrl:
        "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      reactionType: "like",
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to react to post");
  });

  describeInfrastructureErrors(
    registerReactToPost,
    "react-to-post",
    () => ({
      postUrl:
        "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      reactionType: "like",
      cdpPort: 9222,
    }),
    (error) => vi.mocked(reactToPost).mockRejectedValue(error),
    "Failed to react to post",
  );
});
