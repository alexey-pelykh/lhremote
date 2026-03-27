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

vi.mock("./get-feed.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  parseTimestamp: vi.fn((raw: string | null) => {
    if (!raw) return null;
    const asDate = Date.parse(raw);
    if (!isNaN(asDate)) return asDate;
    return null;
  }),
}));

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import { getPost } from "./get-post.js";

describe("getPost", () => {
  const CDP_PORT = 9222;
  const POST_URL =
    "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/";

  const DEFAULT_POST_DETAIL = {
    authorName: "John Doe",
    authorHeadline: "Software Engineer",
    authorProfileUrl: "https://www.linkedin.com/in/johndoe",
    text: "Hello world! This is a long post text.",
    reactionCount: 42,
    commentCount: 5,
    shareCount: 3,
    timestamp: "2024-11-15T10:00:00.000Z",
  };

  const DEFAULT_COMMENTS = [
    {
      authorName: "Alice Smith",
      authorHeadline: "Product Manager",
      authorPublicId: "alices",
      text: "Great post!",
      createdAt: "2024-11-15T11:00:00.000Z",
      reactionCount: 2,
    },
  ];

  function setupMocks(opts?: {
    postDetail?: unknown;
    comments?: unknown;
    readySequence?: boolean[];
    articleCount?: number;
    loadMoreClicked?: boolean[];
  }) {
    const {
      postDetail = DEFAULT_POST_DETAIL,
      comments = DEFAULT_COMMENTS,
      readySequence = [true],
      articleCount = 1,
      loadMoreClicked = [false],
    } = opts ?? {};

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
    const navigate = vi.fn().mockResolvedValue(undefined);

    // Build evaluate mock call sequence:
    // 1. readiness checks (boolean)
    // 2. post detail (object)
    // 3. article count for load-more loop (number)
    // 4. load more click result (boolean) — repeats until false
    // 5. final comments scrape (array)
    const evaluateMock = vi.fn();
    for (const ready of readySequence) {
      evaluateMock.mockResolvedValueOnce(ready);
    }
    evaluateMock.mockResolvedValueOnce(postDetail);
    evaluateMock.mockResolvedValueOnce(articleCount);
    for (const clicked of loadMoreClicked) {
      evaluateMock.mockResolvedValueOnce(clicked);
      if (clicked) {
        // After a successful click, the loop checks article count again
        evaluateMock.mockResolvedValueOnce(articleCount);
      }
    }
    evaluateMock.mockResolvedValueOnce(comments);

    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect,
        navigate,
        evaluate: evaluateMock,
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as CDPClient;
    });

    return { evaluateMock, disconnect, navigate };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      getPost({ postUrl: POST_URL, cdpPort: CDP_PORT, cdpHost: "192.168.1.1" }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("throws when no LinkedIn page found", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([]);

    await expect(getPost({ postUrl: POST_URL, cdpPort: CDP_PORT })).rejects.toThrow(
      "No LinkedIn page found in LinkedHelper",
    );
  });

  it("navigates to post detail URL and extracts post data from DOM", async () => {
    const { navigate } = setupMocks();

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/",
    );

    expect(result.post.postUrn).toBe("urn:li:activity:1234567890");
    expect(result.post.authorName).toBe("John Doe");
    expect(result.post.authorHeadline).toBe("Software Engineer");
    expect(result.post.authorPublicId).toBe("johndoe");
    expect(result.post.text).toBe("Hello world! This is a long post text.");
    expect(result.post.reactionCount).toBe(42);
    expect(result.post.commentCount).toBe(5);
    expect(result.post.shareCount).toBe(3);
  });

  it("extracts comments from DOM", async () => {
    setupMocks();

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({
      commentUrn: null,
      authorName: "Alice Smith",
      authorHeadline: "Product Manager",
      authorPublicId: "alices",
      text: "Great post!",
      reactionCount: 2,
    });
  });

  it("returns paging metadata from visible comments", async () => {
    setupMocks({
      comments: [
        { authorName: "A", text: "c1", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
        { authorName: "B", text: "c2", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
      ],
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(result.commentsPaging).toEqual({
      start: 0,
      count: 2,
      total: 2,
    });
  });

  it("handles empty comments gracefully", async () => {
    setupMocks({ comments: [] });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(result.comments).toEqual([]);
    expect(result.commentsPaging).toEqual({ start: 0, count: 0, total: 0 });
  });

  it("handles null evaluate result for comments", async () => {
    setupMocks({ comments: null });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(result.comments).toEqual([]);
  });

  it("throws when post detail extraction fails", async () => {
    setupMocks({ postDetail: null });

    await expect(getPost({ postUrl: POST_URL, cdpPort: CDP_PORT })).rejects.toThrow(
      "Failed to extract post detail from the DOM",
    );
  });

  it("handles missing optional fields in post detail", async () => {
    setupMocks({
      postDetail: {
        authorName: null,
        authorHeadline: null,
        authorProfileUrl: null,
        text: null,
        reactionCount: 0,
        commentCount: 0,
        shareCount: 0,
        timestamp: null,
      },
      comments: [],
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(result.post.postUrn).toBe("urn:li:activity:1234567890");
    expect(result.post.authorName).toBe("");
    expect(result.post.authorHeadline).toBeNull();
    expect(result.post.authorPublicId).toBeNull();
    expect(result.post.text).toBe("");
    expect(result.post.publishedAt).toBeNull();
    expect(result.post.reactionCount).toBe(0);
    expect(result.post.commentCount).toBe(0);
    expect(result.post.shareCount).toBe(0);
  });

  it("waits for post to load with polling", async () => {
    const { evaluateMock } = setupMocks({
      readySequence: [false, false, true],
    });

    await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    // 3 readiness + 1 post detail + 1 article count + 1 load-more (false) + 1 comments = 7
    expect(evaluateMock).toHaveBeenCalledTimes(7);
  });

  it("extracts authorPublicId from profile URL", async () => {
    setupMocks({
      postDetail: {
        ...DEFAULT_POST_DETAIL,
        authorProfileUrl: "https://www.linkedin.com/in/jane-doe-123",
      },
      comments: [],
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });
    expect(result.post.authorPublicId).toBe("jane-doe-123");
  });

  it("returns null authorPublicId for company URLs", async () => {
    setupMocks({
      postDetail: {
        ...DEFAULT_POST_DETAIL,
        authorProfileUrl: "https://www.linkedin.com/company/acme-corp",
      },
      comments: [],
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });
    expect(result.post.authorPublicId).toBeNull();
  });

  it("clicks load-more to expand comments", async () => {
    setupMocks({
      articleCount: 2,
      loadMoreClicked: [true, true, false],
      comments: [
        { authorName: "A", text: "c1", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
        { authorName: "B", text: "c2", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
        { authorName: "C", text: "c3", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
      ],
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(result.comments).toHaveLength(3);
  });

  it("skips comment loading when commentCount is 0", async () => {
    const { evaluateMock } = setupMocks({ comments: [] });

    const result = await getPost({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      commentCount: 0,
    });

    expect(result.comments).toEqual([]);
    // readiness + post detail + comments scrape (no load-more loop)
    // With commentCount=0: 1 ready + 1 post + 1 comments = 3
    expect(evaluateMock).toHaveBeenCalledTimes(3);
  });

  it("limits comments to commentCount", async () => {
    setupMocks({
      comments: [
        { authorName: "A", text: "c1", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
        { authorName: "B", text: "c2", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
        { authorName: "C", text: "c3", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
      ],
    });

    const result = await getPost({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      commentCount: 2,
    });

    expect(result.comments).toHaveLength(2);
  });

  it("disconnects CDP client after successful operation", async () => {
    const { disconnect } = setupMocks();

    await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(disconnect).toHaveBeenCalled();
  });

  it("disconnects CDP client even on error", async () => {
    const { disconnect } = setupMocks({ postDetail: null });

    await expect(getPost({ postUrl: POST_URL, cdpPort: CDP_PORT })).rejects.toThrow();

    expect(disconnect).toHaveBeenCalled();
  });
});
