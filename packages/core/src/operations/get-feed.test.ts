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
import { getFeed, extractHashtags, parseTimestamp } from "./get-feed.js";
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

describe("getFeed", () => {
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

    const result = await getFeed({ cdpPort: CDP_PORT });

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

  it("constructs URL when raw post has null url", async () => {
    setupMocks([rawPost({ urn: "urn:li:activity:456", url: null })]);

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.url).toBe(
      "https://www.linkedin.com/feed/update/urn:li:activity:456/",
    );
  });

  it("navigates to the LinkedIn feed page", async () => {
    const { navigate } = setupMocks([]);

    await getFeed({ cdpPort: CDP_PORT });

    expect(navigate).toHaveBeenCalledWith("https://www.linkedin.com/feed/");
  });

  it("returns null authorPublicId for all posts", async () => {
    setupMocks([rawPost()]);

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.authorPublicId).toBeNull();
  });

  it("limits results to count parameter", async () => {
    setupMocks([
      rawPost({ urn: "urn:li:activity:1" }),
      rawPost({ urn: "urn:li:activity:2" }),
      rawPost({ urn: "urn:li:activity:3" }),
    ]);

    const result = await getFeed({ cdpPort: CDP_PORT, count: 2 });

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

    const result = await getFeed({ cdpPort: CDP_PORT, count: 2 });

    expect(result.nextCursor).toBe("urn:li:activity:2");
  });

  it("returns null nextCursor when all posts are returned", async () => {
    setupMocks([
      rawPost({ urn: "urn:li:activity:1" }),
      rawPost({ urn: "urn:li:activity:2" }),
    ]);

    const result = await getFeed({ cdpPort: CDP_PORT, count: 10 });

    expect(result.nextCursor).toBeNull();
  });

  it("supports cursor-based pagination", async () => {
    setupMocks([
      rawPost({ urn: "urn:li:activity:1" }),
      rawPost({ urn: "urn:li:activity:2" }),
      rawPost({ urn: "urn:li:activity:3" }),
      rawPost({ urn: "urn:li:activity:4" }),
    ]);

    const result = await getFeed({
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

    const result = await getFeed({
      cdpPort: CDP_PORT,
      cursor: "urn:li:activity:2",
    });

    expect(result.posts).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("treats unknown cursor as start of feed", async () => {
    setupMocks([
      rawPost({ urn: "urn:li:activity:1" }),
      rawPost({ urn: "urn:li:activity:2" }),
    ]);

    const result = await getFeed({
      cdpPort: CDP_PORT,
      cursor: "urn:li:activity:unknown",
    });

    // When cursor is not found, all posts are returned from the start
    expect(result.posts).toHaveLength(2);
  });

  it("handles empty feed", async () => {
    setupMocks([]);

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("handles posts with null fields", async () => {
    setupMocks([rawPost()]);

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.authorName).toBeNull();
    expect(result.posts[0]?.authorHeadline).toBeNull();
    expect(result.posts[0]?.authorProfileUrl).toBeNull();
    expect(result.posts[0]?.text).toBeNull();
    expect(result.posts[0]?.mediaType).toBeNull();
    expect(result.posts[0]?.timestamp).toBeNull();
  });

  it("scrolls to load more posts when count exceeds initial scrape", async () => {
    const { evaluate, send } = setupMocks([]);

    // waitForFeedLoad returns count > 0
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

    const result = await getFeed({ cdpPort: CDP_PORT, count: 4 });

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
    // Every scrape returns same 2 posts
    const fixedPosts = [
      rawPost({ urn: "urn:li:activity:1" }),
      rawPost({ urn: "urn:li:activity:2" }),
    ];
    evaluate.mockResolvedValue(fixedPosts);

    const result = await getFeed({ cdpPort: CDP_PORT, count: 10 });

    expect(result.posts).toHaveLength(2);
    // Should have scrolled once and then stopped (no new posts)
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("throws when no LinkedIn page found", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([]);

    await expect(getFeed({ cdpPort: CDP_PORT })).rejects.toThrow(
      "No LinkedIn page found in LinkedHelper",
    );
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      getFeed({ cdpPort: CDP_PORT, cdpHost: "192.168.1.1" }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("disconnects CDP client after operation", async () => {
    const { disconnect } = setupMocks([rawPost()]);

    await getFeed({ cdpPort: CDP_PORT });

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

    await expect(getFeed({ cdpPort: CDP_PORT })).rejects.toThrow("nav error");
    expect(disconnect).toHaveBeenCalled();
  });

  it("parses relative timestamp into epoch milliseconds", async () => {
    const now = Date.now();
    setupMocks([rawPost({ timestamp: "2h" })]);

    const result = await getFeed({ cdpPort: CDP_PORT });

    const ts = result.posts[0]?.timestamp;
    expect(ts).toBeTypeOf("number");
    // Should be approximately 2 hours ago (within 5 seconds tolerance)
    const twoHoursMs = 2 * 60 * 60 * 1000;
    expect(Math.abs((now - twoHoursMs) - (ts as number))).toBeLessThan(5000);
  });

  it("extracts and deduplicates hashtags from post text", async () => {
    setupMocks([
      rawPost({
        text: "#AI and #MachineLearning are #AI transforming",
      }),
    ]);

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.hashtags).toEqual(["AI", "MachineLearning"]);
  });

  it("returns empty hashtags when no text", async () => {
    setupMocks([rawPost()]);

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.hashtags).toEqual([]);
  });
});

describe("extractHashtags", () => {
  it("extracts unique hashtags", () => {
    expect(extractHashtags("#hello #world #hello")).toEqual(["hello", "world"]);
  });

  it("handles accented characters", () => {
    expect(extractHashtags("#café #résumé")).toEqual(["café", "résumé"]);
  });

  it("returns empty array for null text", () => {
    expect(extractHashtags(null)).toEqual([]);
  });

  it("returns empty array when no hashtags", () => {
    expect(extractHashtags("no hashtags here")).toEqual([]);
  });
});

describe("parseTimestamp", () => {
  it("parses seconds", () => {
    const now = Date.now();
    const result = parseTimestamp("30s");
    expect(result).toBeTypeOf("number");
    expect(Math.abs((now - 30_000) - (result as number))).toBeLessThan(1000);
  });

  it("parses minutes", () => {
    const now = Date.now();
    const result = parseTimestamp("52m");
    expect(result).toBeTypeOf("number");
    expect(Math.abs((now - 52 * 60_000) - (result as number))).toBeLessThan(1000);
  });

  it("parses hours", () => {
    const now = Date.now();
    const result = parseTimestamp("16h");
    expect(result).toBeTypeOf("number");
    expect(Math.abs((now - 16 * 3_600_000) - (result as number))).toBeLessThan(1000);
  });

  it("parses days", () => {
    const now = Date.now();
    const result = parseTimestamp("3d");
    expect(result).toBeTypeOf("number");
    expect(Math.abs((now - 3 * 86_400_000) - (result as number))).toBeLessThan(1000);
  });

  it("parses weeks", () => {
    const now = Date.now();
    const result = parseTimestamp("1w");
    expect(result).toBeTypeOf("number");
    expect(Math.abs((now - 604_800_000) - (result as number))).toBeLessThan(1000);
  });

  it("parses ISO datetime", () => {
    expect(parseTimestamp("2026-03-25T10:00:00Z")).toBe(
      Date.parse("2026-03-25T10:00:00Z"),
    );
  });

  it("returns null for null input", () => {
    expect(parseTimestamp(null)).toBeNull();
  });

  it("returns null for unrecognised format", () => {
    expect(parseTimestamp("unknown")).toBeNull();
  });
});
