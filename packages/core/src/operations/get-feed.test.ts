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

/**
 * Build a minimal GraphQL feed response wrapper.
 */
function graphqlBody(
  elements: unknown[],
  metadata?: Record<string, unknown>,
) {
  return {
    data: {
      feedDashMainFeedByMainFeed: {
        elements,
        ...(metadata ? { metadata } : {}),
      },
    },
  };
}

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

  it("parses feed elements from the GraphQL response", async () => {
    const { fetchMock } = setupMocks(
      graphqlBody(
        [
          {
            metadata: {
              backendUrn: "urn:li:activity:123",
              shareUrn: "urn:li:share:111",
            },
            header: {
              text: { text: "Alice Smith" },
              image: { accessibilityText: "Engineer at Acme" },
              navigationUrl: "https://www.linkedin.com/in/alice/",
            },
            commentary: {
              text: { text: "Hello #linkedin #tech world!" },
            },
            content: {
              imageComponent: { images: [] },
            },
            socialContent: {
              shareUrl: "https://www.linkedin.com/posts/alice_hello-activity-123",
            },
          },
        ],
        { paginationToken: "cursor-abc" },
      ),
    );

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts).toHaveLength(1);
    const [post] = result.posts;
    expect(post?.urn).toBe("urn:li:activity:123");
    expect(post?.url).toBe("https://www.linkedin.com/posts/alice_hello-activity-123");
    expect(post?.authorName).toBe("Alice Smith");
    expect(post?.authorHeadline).toBe("Engineer at Acme");
    expect(post?.authorProfileUrl).toBe("https://www.linkedin.com/in/alice/");
    expect(post?.text).toBe("Hello #linkedin #tech world!");
    expect(post?.mediaType).toBe("image");
    expect(post?.hashtags).toEqual(["linkedin", "tech"]);
    expect(result.nextCursor).toBe("cursor-abc");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/voyager/api/graphql"),
    );
  });

  it("falls back to constructed URL when shareUrl is absent", async () => {
    setupMocks(
      graphqlBody([
        {
          metadata: { backendUrn: "urn:li:activity:456" },
        },
      ]),
    );

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.url).toBe(
      "https://www.linkedin.com/feed/update/urn:li:activity:456/",
    );
  });

  it("passes cursor as paginationToken in variables", async () => {
    const { fetchMock } = setupMocks(
      graphqlBody([]),
    );

    await getFeed({ cdpPort: CDP_PORT, cursor: "my-cursor-token" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("paginationToken%3Amy-cursor-token"),
    );
  });

  it("passes count in variables", async () => {
    const { fetchMock } = setupMocks(
      graphqlBody([]),
    );

    await getFeed({ cdpPort: CDP_PORT, count: 5 });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("count%3A5"),
    );
  });

  it("defaults to count=10", async () => {
    const { fetchMock } = setupMocks(
      graphqlBody([]),
    );

    await getFeed({ cdpPort: CDP_PORT });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("count%3A10"),
    );
  });

  it("skips elements without backendUrn", async () => {
    setupMocks(
      graphqlBody([
        { metadata: {} },
        { metadata: { backendUrn: "urn:li:activity:999" } },
      ]),
    );

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.urn).toBe("urn:li:activity:999");
  });

  it("extracts and deduplicates hashtags from post text", async () => {
    setupMocks(
      graphqlBody([
        {
          metadata: { backendUrn: "urn:li:activity:100" },
          commentary: {
            text: { text: "#AI and #MachineLearning are #AI transforming" },
          },
        },
      ]),
    );

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.hashtags).toEqual(["AI", "MachineLearning"]);
  });

  it("returns empty hashtags when no text", async () => {
    setupMocks(
      graphqlBody([
        { metadata: { backendUrn: "urn:li:activity:101" } },
      ]),
    );

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.hashtags).toEqual([]);
  });

  it("infers video media type from content component key", async () => {
    setupMocks(
      graphqlBody([
        {
          metadata: { backendUrn: "urn:li:activity:200" },
          content: { linkedInVideoComponent: {} },
        },
      ]),
    );

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.mediaType).toBe("video");
  });

  it("infers article media type from content component key", async () => {
    setupMocks(
      graphqlBody([
        {
          metadata: { backendUrn: "urn:li:activity:201" },
          content: { articleComponent: { navigationUrl: "https://example.com/article" } },
        },
      ]),
    );

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.mediaType).toBe("article");
  });

  it("infers document media type from content component key", async () => {
    setupMocks(
      graphqlBody([
        {
          metadata: { backendUrn: "urn:li:activity:202" },
          content: { documentComponent: {} },
        },
      ]),
    );

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.mediaType).toBe("document");
  });

  it("returns null media type when content is absent", async () => {
    setupMocks(
      graphqlBody([
        { metadata: { backendUrn: "urn:li:activity:203" } },
      ]),
    );

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.mediaType).toBeNull();
  });

  it("returns null nextCursor when paginationToken is absent", async () => {
    setupMocks(
      graphqlBody(
        [{ metadata: { backendUrn: "urn:li:activity:300" } }],
      ),
    );

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.nextCursor).toBeNull();
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
    const { disconnect } = setupMocks(graphqlBody([]));

    await getFeed({ cdpPort: CDP_PORT });

    expect(disconnect).toHaveBeenCalled();
  });

  it("disconnects CDP client even on error", async () => {
    const { disconnect } = setupMocks(null, 500);

    await expect(getFeed({ cdpPort: CDP_PORT })).rejects.toThrow();

    expect(disconnect).toHaveBeenCalled();
  });

  it("handles elements with header but no author headline", async () => {
    setupMocks(
      graphqlBody([
        {
          metadata: { backendUrn: "urn:li:activity:400" },
          header: {
            text: { text: "Acme Corp" },
            navigationUrl: "https://www.linkedin.com/company/acme/",
          },
        },
      ]),
    );

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.authorName).toBe("Acme Corp");
    expect(result.posts[0]?.authorHeadline).toBeNull();
    expect(result.posts[0]?.authorProfileUrl).toBe("https://www.linkedin.com/company/acme/");
  });

  it("handles elements with no header at all", async () => {
    setupMocks(
      graphqlBody([
        { metadata: { backendUrn: "urn:li:activity:500" } },
      ]),
    );

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.authorName).toBeNull();
    expect(result.posts[0]?.authorHeadline).toBeNull();
    expect(result.posts[0]?.authorProfileUrl).toBeNull();
  });

  it("uses GraphQL query path with queryId", async () => {
    const { fetchMock } = setupMocks(graphqlBody([]));

    await getFeed({ cdpPort: CDP_PORT });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("queryId=voyagerFeedDashMainFeed"),
    );
  });

  it("sets start to count value when cursor is provided", async () => {
    const { fetchMock } = setupMocks(graphqlBody([]));

    await getFeed({ cdpPort: CDP_PORT, count: 7, cursor: "tok" });

    const calledPath = fetchMock.mock.calls[0]?.[0] as string;
    const decoded = decodeURIComponent(calledPath);
    expect(decoded).toContain("start:7");
    expect(decoded).toContain("count:7");
    expect(decoded).toContain("paginationToken:tok");
  });

  it("sets start to 0 when no cursor is provided", async () => {
    const { fetchMock } = setupMocks(graphqlBody([]));

    await getFeed({ cdpPort: CDP_PORT });

    const calledPath = fetchMock.mock.calls[0]?.[0] as string;
    const decoded = decodeURIComponent(calledPath);
    expect(decoded).toContain("start:0");
  });

  it("ignores content keys with null values for media type", async () => {
    setupMocks(
      graphqlBody([
        {
          metadata: { backendUrn: "urn:li:activity:600" },
          content: {
            imageComponent: null,
            articleComponent: null,
            linkedInVideoComponent: { url: "video-url" },
          },
        },
      ]),
    );

    const result = await getFeed({ cdpPort: CDP_PORT });

    expect(result.posts[0]?.mediaType).toBe("video");
  });
});
