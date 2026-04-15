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

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
  gaussianBetween: vi.fn().mockReturnValue(800),
  maybeHesitate: vi.fn().mockResolvedValue(undefined),
  maybeBreak: vi.fn().mockResolvedValue(undefined),
  simulateReadingTime: vi.fn().mockResolvedValue(undefined),
}));

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import { searchPosts } from "./search-posts.js";
import type { RawDomPost } from "./get-feed.js";

const CDP_PORT = 9222;

/**
 * Build a minimal raw DOM post object for test assertions.
 */
function rawPost(overrides: Partial<RawDomPost> = {}): RawDomPost {
  return {
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

/**
 * Create a script-aware evaluate mock that handles the searchPosts call
 * sequence:
 * 1. waitForSearchResults → truthy when posts exist
 * 2. SCRAPE_SEARCH_RESULTS_SCRIPT → posts array (may repeat on scroll)
 */
function createEvaluateMock(scrapedPosts: RawDomPost[]) {
  return vi.fn().mockImplementation((script: string) => {
    const s = String(script);
    // Scrape script: contains parseCount function
    if (s.includes("parseCount")) {
      return Promise.resolve(scrapedPosts);
    }
    // waitForSearchResults: always pass (page loaded)
    if (s.includes("Open control menu") || s.includes("mainFeed")) {
      return Promise.resolve(true);
    }
    return Promise.resolve(null);
  });
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
  const evaluate = createEvaluateMock(scrapedPosts);

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

  it("returns posts with pre-populated URLs", async () => {
    setupMocks([
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
    ]);

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT });

    expect(result.posts).toHaveLength(2);
    expect(result.posts[0]?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:1/");
    expect(result.posts[1]?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:2/");
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
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:3/" }),
    ]);

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 2 });

    expect(result.posts).toHaveLength(2);
    expect(result.posts[0]?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:1/");
    expect(result.posts[1]?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:2/");
  });

  it("returns nextCursor when more posts are available", async () => {
    setupMocks([
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:3/" }),
    ]);

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 2 });

    expect(result.nextCursor).toBe(2);
  });

  it("returns null nextCursor when all posts are returned", async () => {
    setupMocks([
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
    ]);

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 10 });

    expect(result.nextCursor).toBeNull();
  });

  it("supports cursor-based pagination", async () => {
    setupMocks([
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:3/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:4/" }),
    ]);

    const result = await searchPosts({
      query: "test",
      cdpPort: CDP_PORT,
      count: 2,
      cursor: 2,
    });

    expect(result.posts).toHaveLength(2);
    expect(result.posts[0]?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:3/");
    expect(result.posts[1]?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:4/");
  });

  it("returns empty posts when cursor is at the end", async () => {
    setupMocks([
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
    ]);

    const result = await searchPosts({
      query: "test",
      cdpPort: CDP_PORT,
      cursor: 2,
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

    const firstScrape = [
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
    ];
    const secondScrape = [
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:3/" }),
    ];

    let scrapeIdx = 0;

    evaluate.mockReset();
    evaluate.mockImplementation((script: string) => {
      const s = String(script);
      if (s.includes("parseCount")) {
        const result = [firstScrape, secondScrape][scrapeIdx] ?? secondScrape;
        scrapeIdx++;
        return Promise.resolve(result);
      }
      if (s.includes("Open control menu") || s.includes("mainFeed")) {
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 3 });

    expect(result.posts).toHaveLength(3);
    const scrollCalls = send.mock.calls.filter(
      (args) => args[0] === "Input.dispatchMouseEvent",
    );
    expect(scrollCalls).toHaveLength(1);
  });

  it("stops scrolling when no new posts appear", async () => {
    const { evaluate, send } = setupMocks([]);

    const fixedPosts = [
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
    ];

    evaluate.mockReset();
    evaluate.mockImplementation((script: string) => {
      const s = String(script);
      if (s.includes("parseCount")) return Promise.resolve(fixedPosts);
      if (s.includes("Open control menu") || s.includes("mainFeed")) {
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 10 });

    expect(result.posts).toHaveLength(2);
    const scrollCalls = send.mock.calls.filter(
      (args) => args[0] === "Input.dispatchMouseEvent",
    );
    expect(scrollCalls).toHaveLength(1);
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
