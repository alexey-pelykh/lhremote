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
  const navigate = vi.fn().mockResolvedValue({ frameId: "F1" });
  vi.mocked(CDPClient).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      navigate,
    } as unknown as CDPClient;
  });

  const enableMock = vi.fn().mockResolvedValue(undefined);
  const disableMock = vi.fn().mockResolvedValue(undefined);
  const waitForResponseMock = vi
    .fn()
    .mockResolvedValue({ url: "", status, body });
  vi.mocked(VoyagerInterceptor).mockImplementation(function () {
    return {
      enable: enableMock,
      disable: disableMock,
      waitForResponse: waitForResponseMock,
    } as unknown as VoyagerInterceptor;
  });

  return { navigate, enableMock, disableMock, waitForResponseMock, disconnect };
}

describe("getFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses feed elements from the GraphQL response", async () => {
    setupMocks(
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

  it("navigates to the LinkedIn feed page", async () => {
    const { navigate } = setupMocks(graphqlBody([]));

    await getFeed({ cdpPort: CDP_PORT });

    expect(navigate).toHaveBeenCalledWith("https://www.linkedin.com/feed/");
  });

  it("enables interceptor before navigation and disables after", async () => {
    const { enableMock, disableMock, navigate } = setupMocks(graphqlBody([]));

    await getFeed({ cdpPort: CDP_PORT });

    expect(enableMock).toHaveBeenCalled();
    expect(disableMock).toHaveBeenCalled();

    // enable must be called before navigate
    const enableOrder = enableMock.mock.invocationCallOrder[0] as number;
    const navigateOrder = navigate.mock.invocationCallOrder[0] as number;
    const disableOrder = disableMock.mock.invocationCallOrder[0] as number;
    expect(enableOrder).toBeLessThan(navigateOrder);
    expect(navigateOrder).toBeLessThan(disableOrder);
  });

  it("waits for voyagerFeedDashMainFeed response", async () => {
    const { waitForResponseMock } = setupMocks(graphqlBody([]));

    await getFeed({ cdpPort: CDP_PORT });

    expect(waitForResponseMock).toHaveBeenCalledWith(expect.any(Function));
    // Verify the filter function matches the expected query name
    const filter = waitForResponseMock.mock.calls[0]?.[0] as (
      url: string,
    ) => boolean;
    expect(
      filter(
        "/voyager/api/graphql?queryId=voyagerFeedDashMainFeed.abc123&variables=...",
      ),
    ).toBe(true);
    expect(
      filter(
        "/voyager/api/graphql?queryId=voyagerSearchDashClusters.xyz&variables=...",
      ),
    ).toBe(false);
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

  it("disables interceptor even on error", async () => {
    const { disableMock } = setupMocks(null, 500);

    await expect(getFeed({ cdpPort: CDP_PORT })).rejects.toThrow();

    expect(disableMock).toHaveBeenCalled();
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
