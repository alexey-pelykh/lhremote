// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("./navigate-away.js", () => ({
  navigateAwayIf: vi.fn().mockResolvedValue(undefined),
}));

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import { searchPosts } from "./search-posts.js";
import type { RawDomPost } from "./get-feed.js";

const CDP_PORT = 9222;

/**
 * Build a minimal raw DOM post object.
 */
function rawPost(overrides: Partial<RawDomPost> = {}): RawDomPost {
  return {
    urn: "urn:li:activity:123",
    url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
    authorName: null,
    authorHeadline: null,
    authorProfileUrl: null,
    text: null,
    mediaType: null,
    reactionCount: 0,
    commentCount: 0,
    shareCount: 0,
    timestamp: null,
    ...overrides,
  };
}

function setupMocks(scrapedPosts: RawDomPost[] = []) {
  vi.mocked(discoverTargets).mockResolvedValue([
    {
      id: "target-1",
      type: "page",
      title: "LinkedIn",
      url: "https://www.linkedin.com/feed/",
      description: "",
      devtoolsFrontendUrl: "",
    },
  ]);

  const disconnect = vi.fn();
  const navigate = vi.fn().mockResolvedValue({ frameId: "F1" });
  const send = vi.fn().mockResolvedValue(undefined);

  // evaluate: first call is waitForFeedLoad check, subsequent calls return scraped posts
  const evaluate = vi.fn();
  // First call from waitForFeedLoad — return count > 0 to skip polling
  evaluate.mockResolvedValueOnce(scrapedPosts.length || 1);
  // Subsequent calls from SCRAPE_FEED_SCRIPT
  evaluate.mockResolvedValue(scrapedPosts);

  vi.mocked(CDPClient).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      navigate,
      evaluate,
      send,
    } as unknown as CDPClient;
  });

  return { navigate, disconnect, evaluate, send };
}

describe("searchPosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses posts from DOM-scraped data", async () => {
    setupMocks([
      rawPost({
        urn: "urn:li:activity:123",
        url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
        authorName: "Alice Smith",
        authorHeadline: "Engineer at Acme",
        authorProfileUrl: "https://www.linkedin.com/in/alice",
        text: "Hello #linkedin #tech world!",
        mediaType: "image",
        reactionCount: 42,
        commentCount: 7,
        shareCount: 3,
        timestamp: "2h",
      }),
    ]);

    const result = await searchPosts({ query: "linkedin", cdpPort: CDP_PORT });

    expect(result.query).toBe("linkedin");
    expect(result.posts).toHaveLength(1);
    const [post] = result.posts;
    expect(post?.urn).toBe("urn:li:activity:123");
    expect(post?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:123/");
    expect(post?.authorName).toBe("Alice Smith");
    expect(post?.authorHeadline).toBe("Engineer at Acme");
    expect(post?.authorProfileUrl).toBe("https://www.linkedin.com/in/alice");
    expect(post?.text).toBe("Hello #linkedin #tech world!");
    expect(post?.mediaType).toBe("image");
    expect(post?.reactionCount).toBe(42);
    expect(post?.commentCount).toBe(7);
    expect(post?.shareCount).toBe(3);
    expect(post?.hashtags).toEqual(["linkedin", "tech"]);
  });

  it("navigates to the search results page with query", async () => {
    const { navigate } = setupMocks([]);

    await searchPosts({ query: "AI agents", cdpPort: CDP_PORT });

    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("/search/results/content/"),
    );
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("keywords=AI+agents"),
    );
  });

  it("throws on empty query", async () => {
    await expect(
      searchPosts({ query: "   ", cdpPort: CDP_PORT }),
    ).rejects.toThrow("Search query must not be empty");
  });

  it("limits results to count parameter", async () => {
    setupMocks([
      rawPost({ urn: "urn:li:activity:1" }),
      rawPost({ urn: "urn:li:activity:2" }),
      rawPost({ urn: "urn:li:activity:3" }),
    ]);

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 2 });

    expect(result.posts).toHaveLength(2);
    expect(result.posts[0]?.urn).toBe("urn:li:activity:1");
    expect(result.posts[1]?.urn).toBe("urn:li:activity:2");
  });

  it("returns nextCursor when more posts are available", async () => {
    setupMocks([
      rawPost({ urn: "urn:li:activity:1" }),
      rawPost({ urn: "urn:li:activity:2" }),
      rawPost({ urn: "urn:li:activity:3" }),
    ]);

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 2 });

    expect(result.nextCursor).toBe("urn:li:activity:2");
  });

  it("returns null nextCursor when all posts are returned", async () => {
    setupMocks([
      rawPost({ urn: "urn:li:activity:1" }),
      rawPost({ urn: "urn:li:activity:2" }),
    ]);

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 10 });

    expect(result.nextCursor).toBeNull();
  });

  it("supports cursor-based pagination", async () => {
    setupMocks([
      rawPost({ urn: "urn:li:activity:1" }),
      rawPost({ urn: "urn:li:activity:2" }),
      rawPost({ urn: "urn:li:activity:3" }),
      rawPost({ urn: "urn:li:activity:4" }),
    ]);

    const result = await searchPosts({
      query: "test",
      cdpPort: CDP_PORT,
      count: 2,
      cursor: "urn:li:activity:2",
    });

    expect(result.posts).toHaveLength(2);
    expect(result.posts[0]?.urn).toBe("urn:li:activity:3");
    expect(result.posts[1]?.urn).toBe("urn:li:activity:4");
  });

  it("returns empty posts when cursor is at the end", async () => {
    setupMocks([
      rawPost({ urn: "urn:li:activity:1" }),
      rawPost({ urn: "urn:li:activity:2" }),
    ]);

    const result = await searchPosts({
      query: "test",
      cdpPort: CDP_PORT,
      cursor: "urn:li:activity:2",
    });

    expect(result.posts).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("handles empty search results", async () => {
    setupMocks([]);

    const result = await searchPosts({ query: "nonexistent", cdpPort: CDP_PORT });

    expect(result.posts).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("scrolls to load more posts when count exceeds initial scrape", async () => {
    const { evaluate, send } = setupMocks([]);

    evaluate.mockReset();
    evaluate.mockResolvedValueOnce(1);
    // First scrape: 2 posts
    evaluate.mockResolvedValueOnce([
      rawPost({ urn: "urn:li:activity:1" }),
      rawPost({ urn: "urn:li:activity:2" }),
    ]);
    // Second scrape after scroll: 4 posts
    evaluate.mockResolvedValueOnce([
      rawPost({ urn: "urn:li:activity:1" }),
      rawPost({ urn: "urn:li:activity:2" }),
      rawPost({ urn: "urn:li:activity:3" }),
      rawPost({ urn: "urn:li:activity:4" }),
    ]);

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 4 });

    expect(result.posts).toHaveLength(4);
    expect(send).toHaveBeenCalledWith("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 300,
      y: 400,
      deltaX: 0,
      deltaY: 800,
    });
  });

  it("stops scrolling when no new posts appear", async () => {
    const { evaluate, send } = setupMocks([]);

    evaluate.mockReset();
    evaluate.mockResolvedValueOnce(1);
    const fixedPosts = [
      rawPost({ urn: "urn:li:activity:1" }),
      rawPost({ urn: "urn:li:activity:2" }),
    ];
    evaluate.mockResolvedValue(fixedPosts);

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 10 });

    expect(result.posts).toHaveLength(2);
    // Should have scrolled once and then stopped (no new posts)
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("throws when no LinkedIn page found", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([]);

    await expect(searchPosts({ query: "test", cdpPort: CDP_PORT })).rejects.toThrow(
      "No LinkedIn page found in LinkedHelper",
    );
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      searchPosts({ query: "test", cdpPort: CDP_PORT, cdpHost: "192.168.1.1" }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("disconnects CDP client after operation", async () => {
    const { disconnect } = setupMocks([rawPost()]);

    await searchPosts({ query: "test", cdpPort: CDP_PORT });

    expect(disconnect).toHaveBeenCalled();
  });

  it("disconnects CDP client even on error", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([
      {
        id: "target-1",
        type: "page",
        title: "LinkedIn",
        url: "https://www.linkedin.com/feed/",
        description: "",
        devtoolsFrontendUrl: "",
      },
    ]);

    const disconnect = vi.fn();
    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect,
        navigate: vi.fn().mockRejectedValue(new Error("nav error")),
        evaluate: vi.fn(),
        send: vi.fn(),
      } as unknown as CDPClient;
    });

    await expect(searchPosts({ query: "test", cdpPort: CDP_PORT })).rejects.toThrow(
      "nav error",
    );
    expect(disconnect).toHaveBeenCalled();
  });
});
