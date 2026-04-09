// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, commentOnPost: vi.fn() };
});

import { commentOnPost } from "@lhremote/core";
import { registerCommentOnPost } from "./comment-on-post.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT = {
  success: true as const,
  postUrl:
    "https://www.linkedin.com/feed/update/urn:li:activity:123/",
  commentText: "Great post!",
  parentCommentUrn: null as string | null,
};

describe("registerCommentOnPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named comment-on-post", () => {
    const { server } = createMockServer();
    registerCommentOnPost(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "comment-on-post",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns result as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerCommentOnPost(server);
    vi.mocked(commentOnPost).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("comment-on-post");
    const result = await handler({
      postUrl:
        "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      text: "Great post!",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("passes parentCommentUrn to core operation", async () => {
    const { server, getHandler } = createMockServer();
    registerCommentOnPost(server);
    const replyResult = { ...MOCK_RESULT, parentCommentUrn: "urn:li:comment:(activity:123,456)" };
    vi.mocked(commentOnPost).mockResolvedValue(replyResult);

    const handler = getHandler("comment-on-post");
    await handler({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      text: "Great post!",
      parentCommentUrn: "urn:li:comment:(activity:123,456)",
      cdpPort: 9222,
    });

    expect(commentOnPost).toHaveBeenCalledWith(
      expect.objectContaining({ parentCommentUrn: "urn:li:comment:(activity:123,456)" }),
    );
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerCommentOnPost(server);
    vi.mocked(commentOnPost).mockRejectedValue(
      new Error("connection refused"),
    );

    const handler = getHandler("comment-on-post");
    const result = (await handler({
      postUrl:
        "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      text: "Great post!",
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to comment on post");
  });

  describeInfrastructureErrors(
    registerCommentOnPost,
    "comment-on-post",
    () => ({
      postUrl:
        "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      text: "Great post!",
      cdpPort: 9222,
    }),
    (error) => vi.mocked(commentOnPost).mockRejectedValue(error),
    "Failed to comment on post",
  );
});
