// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, getFeed: vi.fn() };
});

import { getFeed } from "@lhremote/core";
import { registerGetFeed } from "./get-feed.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT = {
  posts: [
    {
      urn: "urn:li:activity:123",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      authorName: "Alice Smith",
      authorPublicId: null,
      authorHeadline: "Engineer",
      authorProfileUrl: "https://www.linkedin.com/in/alice/",
      text: "Hello #world",
      mediaType: "image",
      reactionCount: 10,
      commentCount: 3,
      shareCount: 1,
      timestamp: 1700000000000,
      hashtags: ["world"],
    },
  ],
  nextCursor: "cursor-abc",
};

describe("registerGetFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named get-feed", () => {
    const { server } = createMockServer();
    registerGetFeed(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "get-feed",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns feed as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerGetFeed(server);
    vi.mocked(getFeed).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("get-feed");
    const result = await handler({ count: 10, cdpPort: 9222 });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("passes cursor to operation", async () => {
    const { server, getHandler } = createMockServer();
    registerGetFeed(server);
    vi.mocked(getFeed).mockResolvedValue({ posts: [], nextCursor: null });

    const handler = getHandler("get-feed");
    await handler({ count: 5, cursor: "my-cursor", cdpPort: 9222 });

    expect(getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ count: 5, cursor: "my-cursor" }),
    );
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerGetFeed(server);
    vi.mocked(getFeed).mockRejectedValue(new Error("connection refused"));

    const handler = getHandler("get-feed");
    const result = (await handler({ cdpPort: 9222 })) as {
      isError?: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to get feed");
  });
});
