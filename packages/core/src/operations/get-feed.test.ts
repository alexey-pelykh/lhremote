// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("../voyager/interceptor.js", () => ({
  VoyagerInterceptor: vi.fn(),
}));

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import { VoyagerInterceptor } from "../voyager/interceptor.js";
import { getFeed } from "./get-feed.js";

const CDP_PORT = 9222;

function setupMocks(body: unknown, status = 200) {
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
    } as unknown as CDPClient;
  });

  const fetchMock = vi.fn().mockResolvedValue({ url: "", status, body });
  vi.mocked(VoyagerInterceptor).mockImplementation(function () {
    return { fetch: fetchMock } as unknown as VoyagerInterceptor;
  });

  return { fetchMock, disconnect };
}

describe("getFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses feed elements with inline actor and social detail", async () => {
    const { fetchMock } = setupMocks({
      data: {
        elements: [
          {
            updateUrn: "urn:li:activity:123",
            actor: {
              name: { text: "Alice Smith" },
              description: { text: "Engineer at Acme" },
              navigationUrl: "https://www.linkedin.com/in/alice/",
            },
            commentary: { text: { text: "Hello #linkedin #tech world!" } },
            content: { mediaCategory: "IMAGE" },
            socialDetail: {
              totalSocialActivityCounts: {
                numLikes: 10,
                numComments: 3,
                numShares: 1,
              },
            },
            createdAt: 1700000000000,
          },
        ],
        metadata: { paginationToken: "cursor-abc" },
      },
    });

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts).toHaveLength(1);
    const [post] = result.posts;
    expect(post?.urn).toBe("urn:li:activity:123");
    expect(post?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:123/");
    expect(post?.authorName).toBe("Alice Smith");
    expect(post?.authorHeadline).toBe("Engineer at Acme");
    expect(post?.authorProfileUrl).toBe("https://www.linkedin.com/in/alice/");
    expect(post?.text).toBe("Hello #linkedin #tech world!");
    expect(post?.mediaType).toBe("image");
    expect(post?.reactionCount).toBe(10);
    expect(post?.commentCount).toBe(3);
    expect(post?.shareCount).toBe(1);
    expect(post?.timestamp).toBe(1700000000000);
    expect(post?.hashtags).toEqual(["linkedin", "tech"]);
    expect(result.nextCursor).toBe("cursor-abc");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/voyager/api/feed/dash/feedUpdates"),
    );
  });

  it("resolves actor from included entities via *actor reference", async () => {
    setupMocks({
      elements: [
        {
          updateUrn: "urn:li:activity:456",
          "*actor": "urn:li:fsd_profile:789",
          commentary: { text: "Post text" },
        },
      ],
      included: [
        {
          entityUrn: "urn:li:fsd_profile:789",
          firstName: "Bob",
          lastName: "Jones",
          publicIdentifier: "bobjones",
          headline: { text: "CEO at Corp" },
        },
      ],
    });

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts).toHaveLength(1);
    const [post] = result.posts;
    expect(post?.authorName).toBe("Bob Jones");
    expect(post?.authorHeadline).toBe("CEO at Corp");
    expect(post?.authorProfileUrl).toBe("https://www.linkedin.com/in/bobjones/");
    expect(result.nextCursor).toBeNull();
  });

  it("resolves social detail from included entities via *socialDetail", async () => {
    setupMocks({
      elements: [
        {
          updateUrn: "urn:li:activity:789",
          "*socialDetail": "urn:li:fsd_socialDetail:789",
        },
      ],
      included: [
        {
          entityUrn: "urn:li:fsd_socialDetail:789",
          totalSocialActivityCounts: {
            numLikes: 50,
            numComments: 20,
            numShares: 5,
          },
        },
      ],
    });

    const result = await getFeed({ cdpPort: CDP_PORT });

    const [post] = result.posts;
    expect(post?.reactionCount).toBe(50);
    expect(post?.commentCount).toBe(20);
    expect(post?.shareCount).toBe(5);
  });

  it("passes cursor as paginationToken query parameter", async () => {
    const { fetchMock } = setupMocks({ elements: [] });

    await getFeed({ cdpPort: CDP_PORT, cursor: "my-cursor-token" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("paginationToken=my-cursor-token"),
    );
  });

  it("passes count query parameter", async () => {
    const { fetchMock } = setupMocks({ elements: [] });

    await getFeed({ cdpPort: CDP_PORT, count: 5 });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("count=5"),
    );
  });

  it("defaults to count=10", async () => {
    const { fetchMock } = setupMocks({ elements: [] });

    await getFeed({ cdpPort: CDP_PORT });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("count=10"),
    );
  });

  it("skips elements without URN", async () => {
    setupMocks({
      elements: [
        { commentary: { text: "no urn" } },
        { updateUrn: "urn:li:activity:999" },
      ],
    });

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.urn).toBe("urn:li:activity:999");
  });

  it("extracts and deduplicates hashtags from post text", async () => {
    setupMocks({
      elements: [
        {
          updateUrn: "urn:li:activity:100",
          commentary: { text: { text: "#AI and #MachineLearning are #AI transforming" } },
        },
      ],
    });

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.hashtags).toEqual(["AI", "MachineLearning"]);
  });

  it("returns empty hashtags when no text", async () => {
    setupMocks({
      elements: [{ updateUrn: "urn:li:activity:101" }],
    });

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.hashtags).toEqual([]);
  });

  it("infers media type from $type when mediaCategory absent", async () => {
    setupMocks({
      elements: [
        {
          updateUrn: "urn:li:activity:200",
          content: { $type: "com.linkedin.voyager.feed.render.VideoComponent" },
        },
      ],
    });

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.mediaType).toBe("video");
  });

  it("infers article from navigationUrl", async () => {
    setupMocks({
      elements: [
        {
          updateUrn: "urn:li:activity:201",
          content: { navigationUrl: "https://example.com/article" },
        },
      ],
    });

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.mediaType).toBe("article");
  });

  it("throws on non-200 response", async () => {
    setupMocks(null, 403);

    await expect(getFeed({ cdpPort: CDP_PORT })).rejects.toThrow(
      "Voyager API returned HTTP 403 for feed",
    );
  });

  it("throws on non-object response body", async () => {
    setupMocks(null, 200);

    await expect(getFeed({ cdpPort: CDP_PORT })).rejects.toThrow(
      "Voyager API returned an unexpected response format for feed",
    );
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
    const { disconnect } = setupMocks({ elements: [] });

    await getFeed({ cdpPort: CDP_PORT });

    expect(disconnect).toHaveBeenCalled();
  });

  it("disconnects CDP client even on error", async () => {
    const { disconnect } = setupMocks(null, 500);

    await expect(getFeed({ cdpPort: CDP_PORT })).rejects.toThrow();

    expect(disconnect).toHaveBeenCalled();
  });

  it("handles company actor from included entities", async () => {
    setupMocks({
      elements: [
        {
          updateUrn: "urn:li:activity:300",
          "*actor": "urn:li:fsd_company:100",
        },
      ],
      included: [
        {
          entityUrn: "urn:li:fsd_company:100",
          name: { text: "Acme Corp" },
          description: { text: "Technology company" },
          navigationUrl: "https://www.linkedin.com/company/acme/",
        },
      ],
    });

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.authorName).toBe("Acme Corp");
    expect(result.posts[0]?.authorHeadline).toBe("Technology company");
    expect(result.posts[0]?.authorProfileUrl).toBe("https://www.linkedin.com/company/acme/");
  });

  it("uses urn field when updateUrn absent", async () => {
    setupMocks({
      elements: [{ urn: "urn:li:activity:400" }],
    });

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.urn).toBe("urn:li:activity:400");
  });

  it("uses publishedAt as fallback timestamp", async () => {
    setupMocks({
      elements: [{ updateUrn: "urn:li:activity:500", publishedAt: 1600000000000 }],
    });

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.timestamp).toBe(1600000000000);
  });
});
