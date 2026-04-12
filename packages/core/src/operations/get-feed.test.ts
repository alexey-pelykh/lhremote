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
import { getFeed, extractHashtags, parseTimestamp } from "./get-feed.js";
import type { RawDomPost } from "./get-feed.js";

const CDP_PORT = 9222;

/**
 * Build a minimal raw DOM post object.
 */
function rawPost(overrides: Partial<RawDomPost> = {}): RawDomPost {
  return {
    url: overrides.url ?? "https://www.linkedin.com/feed/update/urn:li:activity:123/",
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
 * Create a script-aware evaluate mock that handles the getFeed call sequence:
 * 1. waitForFeedLoad → truthy when posts exist
 * 2. Clipboard interceptor install → void
 * 3. SCRAPE_FEED_POSTS_SCRIPT → indexed posts array (may repeat on scroll)
 * 4. Per-post URL capture (interleaved): reset → void, scroll → void,
 *    menu click → true, copy-link click → void, clipboard read → url string
 *
 * The scrape mock adds an `_isNew` field to match the DOM-tagging
 * accumulation strategy.  On the first call all posts are "new"; subsequent
 * calls return the same posts as "already seen" so that the scroll loop
 * exits after one iteration.
 */
function createEvaluateMock(scrapedPosts: RawDomPost[]) {
  let urlIdx = 0;
  let scrapeCallCount = 0;
  return vi.fn().mockImplementation((script: string) => {
    const s = String(script);
    // Order matters: check most specific patterns first
    // Scrape script: long script with parseCount function.
    // Returns posts with discovery-tagging field (_isNew).
    if (s.includes("parseCount")) {
      const isFirstScrape = scrapeCallCount === 0;
      scrapeCallCount++;
      return Promise.resolve(
        scrapedPosts.map((p) => ({
          ...p,
          _isNew: isFirstScrape,
        })),
      );
    }
    // Clipboard interceptor install
    if (s.includes("navigator.clipboard.writeText")) {
      return Promise.resolve(undefined);
    }
    // Clipboard reset
    if (s.includes("__capturedClipboard = null")) {
      return Promise.resolve(undefined);
    }
    // "Copy link to post" menu item click
    if (s.includes("Copy link to post")) {
      return Promise.resolve(undefined);
    }
    // Read captured clipboard URL (exact match — not the reset)
    if (s === "window.__capturedClipboard") {
      const url = scrapedPosts[urlIdx]?.url ?? null;
      urlIdx++;
      return Promise.resolve(url);
    }
    // Menu button click (split from scroll): contains btn.click()
    if (s.includes("btn.click()")) {
      return Promise.resolve(true);
    }
    // Humanized scroll-to-element fallback: contains scrollIntoView
    if (s.includes("scrollIntoView")) {
      return Promise.resolve(undefined);
    }
    // waitForFeedLoad: short script with mainFeed check — always pass
    if (s.includes("mainFeed")) {
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

  it("returns null URL when raw post has null url", async () => {
    setupMocks([rawPost({ url: null })]);

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.url).toBeNull();
  });

  it("retries URL extraction when clipboard capture fails on first attempt", async () => {
    const retryUrl = "https://www.linkedin.com/feed/update/urn:li:activity:retried/";
    // Post scraped without a URL — URL extraction must fill it in
    const post = rawPost({ url: null });

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

    let clipboardReadCount = 0;
    let retryScrapeCount = 0;
    const evaluate = vi.fn().mockImplementation((script: string) => {
      const s = String(script);
      if (s.includes("parseCount")) {
        const isFirst = retryScrapeCount === 0;
        retryScrapeCount++;
        return Promise.resolve([{ ...post, _isNew: isFirst }]);
      }
      if (s.includes("navigator.clipboard.writeText")) return Promise.resolve(undefined);
      if (s.includes("__capturedClipboard = null")) return Promise.resolve(undefined);
      if (s.includes("Copy link to post")) return Promise.resolve(undefined);
      if (s === "window.__capturedClipboard") {
        clipboardReadCount++;
        return Promise.resolve(clipboardReadCount === 1 ? null : retryUrl);
      }
      if (s.includes("btn.click()")) return Promise.resolve(true);
      if (s.includes("scrollIntoView")) return Promise.resolve(undefined);
      if (s.includes("mainFeed")) return Promise.resolve(true);
      return Promise.resolve(undefined);
    });

    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        navigate: vi.fn().mockResolvedValue({ frameId: "F1" }),
        evaluate,
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as CDPClient;
    });

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.url).toBe(retryUrl);
    expect(clipboardReadCount).toBeGreaterThanOrEqual(2);
  });

  it("navigates to the LinkedIn feed page", async () => {
    const { navigate } = setupMocks([rawPost()]);

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
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:3/" }),
    ]);

    const result = await getFeed({ cdpPort: CDP_PORT, count: 2 });

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

    const result = await getFeed({ cdpPort: CDP_PORT, count: 2 });

    expect(result.nextCursor).toBe("https://www.linkedin.com/feed/update/urn:li:activity:2/");
  });

  it("returns nextCursor from nearest post with URL when last post URL is null", async () => {
    // Custom mock: 3 posts where only the first has a successful URL extraction.
    // The clipboard mock returns a URL for the first post only; all subsequent
    // reads return null, causing capturePostUrl to genuinely fail for posts 2–3.
    vi.mocked(discoverTargets).mockResolvedValue([{
      id: "target-1", type: "page", title: "LinkedIn",
      url: "https://www.linkedin.com/feed/",
      description: "", devtoolsFrontendUrl: "",
    }]);

    const posts = [
      { ...rawPost({ url: null }), _isNew: true },
      { ...rawPost({ url: null }), _isNew: true },
      { ...rawPost({ url: null }), _isNew: true },
    ];
    let clipIdx = 0;
    const clipUrls = ["https://www.linkedin.com/feed/update/urn:li:activity:1/"];

    const evaluate = vi.fn().mockImplementation((script: string) => {
      const s = String(script);
      if (s.includes("parseCount")) return Promise.resolve(posts);
      if (s.includes("navigator.clipboard.writeText")) return Promise.resolve(undefined);
      if (s.includes("__capturedClipboard = null")) return Promise.resolve(undefined);
      if (s.includes("Copy link to post")) return Promise.resolve(undefined);
      if (s === "window.__capturedClipboard") {
        const url = clipUrls[clipIdx] ?? null;
        clipIdx++;
        return Promise.resolve(url);
      }
      if (s.includes("btn.click()")) return Promise.resolve(true);
      if (s.includes("scrollIntoView")) return Promise.resolve(undefined);
      if (s.includes("mainFeed")) return Promise.resolve(true);
      return Promise.resolve(null);
    });

    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        navigate: vi.fn().mockResolvedValue({ frameId: "F1" }),
        evaluate,
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as CDPClient;
    });

    const result = await getFeed({ cdpPort: CDP_PORT, count: 2 });

    // Window = [post0 (url:activity:1), post1 (url:null)], hasMore = true
    // post1.url = null → scan backwards → post0.url
    expect(result.posts).toHaveLength(2);
    expect(result.nextCursor).toBe("https://www.linkedin.com/feed/update/urn:li:activity:1/");
  });

  it("stops extracting URLs once accumulationTarget is reached", async () => {
    // 20 posts available, but count=3 → accumulationTarget = 4.
    // Only 4 URL extractions should occur (not 20).
    const posts = Array.from({ length: 20 }, (_, i) => ({
      ...rawPost({
        url: `https://www.linkedin.com/feed/update/urn:li:activity:${String(i + 1)}/`,
      }),
      _isNew: true,
    }));

    let copyLinkClicks = 0;
    let clipIdx = 0;

    vi.mocked(discoverTargets).mockResolvedValue([{
      id: "target-1", type: "page", title: "LinkedIn",
      url: "https://www.linkedin.com/feed/",
      description: "", devtoolsFrontendUrl: "",
    }]);

    const evaluate = vi.fn().mockImplementation((script: string) => {
      const s = String(script);
      if (s.includes("parseCount")) return Promise.resolve(posts);
      if (s.includes("navigator.clipboard.writeText")) return Promise.resolve(undefined);
      if (s.includes("__capturedClipboard = null")) return Promise.resolve(undefined);
      if (s.includes("Copy link to post")) {
        copyLinkClicks++;
        return Promise.resolve(undefined);
      }
      if (s === "window.__capturedClipboard") {
        const url = posts[clipIdx]?.url ?? null;
        clipIdx++;
        return Promise.resolve(url);
      }
      if (s.includes("btn.click()")) return Promise.resolve(true);
      if (s.includes("scrollIntoView")) return Promise.resolve(undefined);
      if (s.includes("mainFeed")) return Promise.resolve(true);
      return Promise.resolve(null);
    });

    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        navigate: vi.fn().mockResolvedValue({ frameId: "F1" }),
        evaluate,
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as CDPClient;
    });

    const result = await getFeed({ cdpPort: CDP_PORT, count: 3 });

    expect(result.posts).toHaveLength(3);
    // Target = count + 1 = 4.  Extraction stops as soon as seenUrls.size
    // reaches 4, so "Copy link to post" is clicked exactly 4 times.
    expect(copyLinkClicks).toBe(4);
  });

  it("returns null nextCursor when all posts are returned", async () => {
    setupMocks([
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
    ]);

    const result = await getFeed({ cdpPort: CDP_PORT, count: 10 });

    expect(result.nextCursor).toBeNull();
  });

  it("supports cursor-based pagination", { timeout: 15_000 }, async () => {
    setupMocks([
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:3/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:4/" }),
    ]);

    const result = await getFeed({
      cdpPort: CDP_PORT,
      count: 2,
      cursor: "https://www.linkedin.com/feed/update/urn:li:activity:2/",
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

    const result = await getFeed({
      cdpPort: CDP_PORT,
      cursor: "https://www.linkedin.com/feed/update/urn:li:activity:2/",
    });

    expect(result.posts).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("treats unknown cursor as start of feed", async () => {
    setupMocks([
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
    ]);

    const result = await getFeed({
      cdpPort: CDP_PORT,
      cursor: "https://www.linkedin.com/feed/update/urn:li:activity:unknown/",
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

  it("scrolls to load more posts when count exceeds initial scrape", { timeout: 15_000 }, async () => {
    const { evaluate, send } = setupMocks([]);

    let scrapeCall = 0;
    const firstScrape = [
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
    ];
    const secondScrape = [
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:3/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:4/" }),
    ];

    let clipIdx = 0;
    evaluate.mockReset();
    evaluate.mockImplementation((script: string) => {
      const s = String(script);
      if (s.includes("parseCount")) {
        scrapeCall++;
        // First scrape: 2 posts, all new.
        // Second scrape: 4 posts — first 2 already tagged, last 2 new.
        if (scrapeCall === 1) {
          return Promise.resolve(firstScrape.map((p) => ({ ...p, _isNew: true })));
        }
        return Promise.resolve(secondScrape.map((p, i) => ({
          ...p, _isNew: i >= firstScrape.length,
        })));
      }
      if (s.includes("navigator.clipboard.writeText")) return Promise.resolve(undefined);
      if (s.includes("__capturedClipboard = null")) return Promise.resolve(undefined);
      if (s.includes("Copy link to post")) return Promise.resolve(undefined);
      if (s === "window.__capturedClipboard") {
        // Return URLs from the combined post list in discovery order
        const allUrls = [...firstScrape, ...secondScrape.slice(firstScrape.length)];
        const url = allUrls[clipIdx]?.url ?? null;
        clipIdx++;
        return Promise.resolve(url);
      }
      if (s.includes("btn.click()")) return Promise.resolve(true);
      if (s.includes("scrollIntoView")) return Promise.resolve(undefined);
      if (s.includes("mainFeed")) return Promise.resolve(true);
      return Promise.resolve(null);
    });

    const result = await getFeed({ cdpPort: CDP_PORT, count: 4 });

    expect(result.posts).toHaveLength(4);
    // scrollFeed uses gaussianBetween (mocked to return 800) for distance, x, and y
    expect(send).toHaveBeenCalledWith("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 800,
      y: 800,
      deltaX: 0,
      deltaY: 800,
    });
  });

  it("stops scrolling when no new posts appear", async () => {
    const { evaluate, send } = setupMocks([]);

    const fixedPosts = [
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
    ];
    let staleScrapeCount = 0;
    let staleClipIdx = 0;

    evaluate.mockReset();
    evaluate.mockImplementation((script: string) => {
      const s = String(script);
      if (s.includes("parseCount")) {
        // First call: posts are new.  Subsequent: same posts, not new.
        const isFirst = staleScrapeCount === 0;
        staleScrapeCount++;
        return Promise.resolve(
          fixedPosts.map((p) => ({ ...p, _isNew: isFirst })),
        );
      }
      if (s.includes("navigator.clipboard.writeText")) return Promise.resolve(undefined);
      if (s.includes("__capturedClipboard = null")) return Promise.resolve(undefined);
      if (s.includes("Copy link to post")) return Promise.resolve(undefined);
      if (s === "window.__capturedClipboard") {
        const url = fixedPosts[staleClipIdx]?.url ?? null;
        staleClipIdx++;
        return Promise.resolve(url);
      }
      if (s.includes("btn.click()")) return Promise.resolve(true);
      if (s.includes("scrollIntoView")) return Promise.resolve(undefined);
      if (s.includes("mainFeed")) return Promise.resolve(true);
      return Promise.resolve(null);
    });

    const result = await getFeed({ cdpPort: CDP_PORT, count: 10 });

    expect(result.posts).toHaveLength(2);
    // At least 1 scroll from the feed loop; confusion scrolls from retry
    // logic may add more Input.dispatchMouseEvent calls.
    const scrollCalls = send.mock.calls.filter(
      (c) => c[0] === "Input.dispatchMouseEvent",
    );
    expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
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
