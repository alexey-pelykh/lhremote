// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, getPost: vi.fn() };
});

import { getPost } from "@lhremote/core";
import { registerGetPost } from "./get-post.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT = {
  post: {
    postUrn: "urn:li:activity:7123456789012345678",
    authorName: "Alice",
    authorHeadline: "Engineer",
    authorPublicId: "alice",
    text: "Hello world",
    publishedAt: 1700000000000,
    reactionCount: 10,
    commentCount: 3,
    shareCount: 1,
  },
  comments: [],
  commentsPaging: { start: 0, count: 100, total: 0 },
};

describe("registerGetPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named get-post", () => {
    const { server } = createMockServer();
    registerGetPost(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "get-post",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns result as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerGetPost(server);
    vi.mocked(getPost).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("get-post");
    const result = await handler({
      postUrl: "urn:li:activity:7123456789012345678",
      commentCount: 100,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("passes commentCount parameter to operation", async () => {
    const { server, getHandler } = createMockServer();
    registerGetPost(server);
    vi.mocked(getPost).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("get-post");
    await handler({
      postUrl: "urn:li:activity:7123456789012345678",
      commentCount: 50,
      cdpPort: 9222,
    });

    expect(getPost).toHaveBeenCalledWith(
      expect.objectContaining({
        postUrl: "urn:li:activity:7123456789012345678",
        commentCount: 50,
        cdpPort: 9222,
      }),
    );
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerGetPost(server);
    vi.mocked(getPost).mockRejectedValue(new Error("connection refused"));

    const handler = getHandler("get-post");
    const result = (await handler({
      postUrl: "urn:li:activity:7123456789012345678",
      commentCount: 100,
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to get post");
  });

  describeInfrastructureErrors(
    registerGetPost,
    "get-post",
    () => ({
      postUrl: "urn:li:activity:7123456789012345678",
      commentCount: 100,
      cdpPort: 9222,
    }),
    (error) => vi.mocked(getPost).mockRejectedValue(error),
    "Failed to get post",
  );
});
