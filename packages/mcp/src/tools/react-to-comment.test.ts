// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, reactToComment: vi.fn() };
});

import { reactToComment } from "@lhremote/core";
import { registerReactToComment } from "./react-to-comment.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const POST_URL = "https://www.linkedin.com/feed/update/urn:li:activity:123/";
const COMMENT_URN = "urn:li:comment:(activity:123,456)";

const MOCK_RESULT = {
  success: true as const,
  postUrl: POST_URL,
  commentUrn: COMMENT_URN,
  reactionType: "like" as const,
  alreadyReacted: false as const,
  currentReaction: null,
  dryRun: false as const,
};

describe("registerReactToComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named react-to-comment", () => {
    const { server } = createMockServer();
    registerReactToComment(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "react-to-comment",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns result as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerReactToComment(server);
    vi.mocked(reactToComment).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("react-to-comment");
    const result = await handler({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "like",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerReactToComment(server);
    vi.mocked(reactToComment).mockRejectedValue(new Error("connection refused"));

    const handler = getHandler("react-to-comment");
    const result = (await handler({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "like",
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to react to comment");
  });

  describeInfrastructureErrors(
    registerReactToComment,
    "react-to-comment",
    () => ({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "like",
      cdpPort: 9222,
    }),
    (error) => vi.mocked(reactToComment).mockRejectedValue(error),
    "Failed to react to comment",
  );
});
