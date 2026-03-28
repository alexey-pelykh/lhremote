// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, searchPosts: vi.fn() };
});

import { searchPosts } from "@lhremote/core";
import type { SearchPostsOutput } from "@lhremote/core";
import { registerSearchPosts } from "./search-posts.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULTS: SearchPostsOutput = {
  query: "AI agents",
  posts: [
    {
      urn: "",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      authorName: "Jane Smith",
      authorHeadline: "CEO at Acme Corp",
      authorProfileUrl: "https://www.linkedin.com/in/janesmith",
      authorPublicId: null,
      text: "Excited about AI agents!",
      mediaType: null,
      reactionCount: 42,
      commentCount: 7,
      shareCount: 3,
      timestamp: null,
      hashtags: [],
    },
  ],
  nextCursor: null,
};

describe("registerSearchPosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named search-posts", () => {
    const { server } = createMockServer();
    registerSearchPosts(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "search-posts",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns search results as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerSearchPosts(server);
    vi.mocked(searchPosts).mockResolvedValue(MOCK_RESULTS);

    const handler = getHandler("search-posts");
    const result = await handler({
      query: "AI agents",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        { type: "text", text: JSON.stringify(MOCK_RESULTS, null, 2) },
      ],
    });
  });

  it("passes pagination parameters to operation", async () => {
    const { server, getHandler } = createMockServer();
    registerSearchPosts(server);
    vi.mocked(searchPosts).mockResolvedValue(MOCK_RESULTS);

    const handler = getHandler("search-posts");
    await handler({
      query: "AI agents",
      cursor: 10,
      count: 5,
      cdpPort: 9222,
    });

    expect(searchPosts).toHaveBeenCalledWith(
      expect.objectContaining({ query: "AI agents", cursor: 10, count: 5 }),
    );
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerSearchPosts(server);
    vi.mocked(searchPosts).mockRejectedValue(
      new Error("connection refused"),
    );

    const handler = getHandler("search-posts");
    const result = (await handler({
      query: "AI agents",
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to search posts");
  });
});
