// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  extractProfileId,
  parseProfileUpdatesResponse,
  type GraphQLProfileUpdatesResponse,
} from "./get-profile-activity.js";

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
import { getProfileActivity } from "./get-profile-activity.js";

const CDP_PORT = 9222;

/**
 * Build a minimal GraphQL profile-updates response wrapper.
 */
function graphqlBody(
  elements: Record<string, unknown>[],
  paging?: Record<string, unknown>,
): GraphQLProfileUpdatesResponse {
  return {
    data: {
      feedDashProfileUpdatesByProfileUpdates: {
        elements,
        ...(paging ? { paging } : {}),
      },
    },
  } as GraphQLProfileUpdatesResponse;
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

describe("extractProfileId", () => {
  it("extracts public ID from full profile URL", () => {
    expect(
      extractProfileId("https://www.linkedin.com/in/johndoe"),
    ).toBe("johndoe");
  });

  it("extracts public ID from profile URL with trailing slash", () => {
    expect(
      extractProfileId("https://www.linkedin.com/in/johndoe/"),
    ).toBe("johndoe");
  });

  it("extracts public ID from profile URL with query params", () => {
    expect(
      extractProfileId(
        "https://www.linkedin.com/in/johndoe?miniProfileUrn=urn",
      ),
    ).toBe("johndoe");
  });

  it("extracts public ID from profile URL with hash", () => {
    expect(
      extractProfileId("https://www.linkedin.com/in/johndoe#section"),
    ).toBe("johndoe");
  });

  it("decodes URL-encoded public ID", () => {
    expect(
      extractProfileId("https://www.linkedin.com/in/john%20doe"),
    ).toBe("john doe");
  });

  it("passes through bare public ID", () => {
    expect(extractProfileId("johndoe")).toBe("johndoe");
  });

  it("passes through bare public ID with hyphens", () => {
    expect(extractProfileId("john-doe-123")).toBe("john-doe-123");
  });

  it("throws on unrecognised URL", () => {
    expect(() => extractProfileId("https://example.com/foo")).toThrow(
      "Cannot extract profile ID from",
    );
  });

  it("throws on empty input", () => {
    expect(() => extractProfileId("")).toThrow(
      "Cannot extract profile ID from",
    );
  });
});

describe("parseProfileUpdatesResponse", () => {
  it("parses elements from the GraphQL response", () => {
    const result = parseProfileUpdatesResponse(
      graphqlBody(
        [
          {
            metadata: {
              backendUrn: "urn:li:activity:123",
              shareUrn: "urn:li:share:111",
            },
            header: {
              text: { text: "Jane Doe" },
              image: { accessibilityText: "Engineer at Acme" },
              navigationUrl: "https://www.linkedin.com/in/janedoe/",
            },
            commentary: {
              text: { text: "Hello world" },
            },
            content: {
              imageComponent: { images: [] },
            },
            socialContent: {
              shareUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123",
            },
          },
        ],
        { start: 0, count: 20, total: 1 },
      ),
    );

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toEqual({
      urn: "urn:li:activity:123",
      text: "Hello world",
      authorName: "Jane Doe",
      authorPublicId: null,
      authorHeadline: "Engineer at Acme",
      authorProfileUrl: "https://www.linkedin.com/in/janedoe/",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:123",
      timestamp: null,
      mediaType: "image",
      reactionCount: 0,
      commentCount: 0,
      shareCount: 0,
      hashtags: [],
    });
    expect(result.paging).toEqual({ start: 0, count: 20, total: 1 });
  });

  it("falls back to constructed URL when shareUrl is absent", () => {
    const result = parseProfileUpdatesResponse(
      graphqlBody([
        {
          metadata: { backendUrn: "urn:li:activity:456" },
        },
      ]),
    );

    expect(result.posts[0]?.url).toBe(
      "https://www.linkedin.com/feed/update/urn:li:activity:456/",
    );
  });

  it("skips elements without backendUrn", () => {
    const result = parseProfileUpdatesResponse(
      graphqlBody([
        { metadata: {} },
        { metadata: { backendUrn: "urn:li:activity:789" } },
      ]),
    );

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.urn).toBe("urn:li:activity:789");
  });

  it("extracts and deduplicates hashtags from post text", () => {
    const result = parseProfileUpdatesResponse(
      graphqlBody([
        {
          metadata: { backendUrn: "urn:li:activity:100" },
          commentary: {
            text: { text: "#AI and #MachineLearning are #AI transforming" },
          },
        },
      ]),
    );

    expect(result.posts[0]?.hashtags).toEqual(["AI", "MachineLearning"]);
  });

  it("returns empty hashtags when no text", () => {
    const result = parseProfileUpdatesResponse(
      graphqlBody([
        { metadata: { backendUrn: "urn:li:activity:101" } },
      ]),
    );

    expect(result.posts[0]?.hashtags).toEqual([]);
  });

  it("infers video media type from content component key", () => {
    const result = parseProfileUpdatesResponse(
      graphqlBody([
        {
          metadata: { backendUrn: "urn:li:activity:200" },
          content: { linkedInVideoComponent: {} },
        },
      ]),
    );

    expect(result.posts[0]?.mediaType).toBe("video");
  });

  it("infers article media type from content component key", () => {
    const result = parseProfileUpdatesResponse(
      graphqlBody([
        {
          metadata: { backendUrn: "urn:li:activity:201" },
          content: { articleComponent: { navigationUrl: "https://example.com/article" } },
        },
      ]),
    );

    expect(result.posts[0]?.mediaType).toBe("article");
  });

  it("infers document media type from content component key", () => {
    const result = parseProfileUpdatesResponse(
      graphqlBody([
        {
          metadata: { backendUrn: "urn:li:activity:202" },
          content: { documentComponent: {} },
        },
      ]),
    );

    expect(result.posts[0]?.mediaType).toBe("document");
  });

  it("returns null media type when content is absent", () => {
    const result = parseProfileUpdatesResponse(
      graphqlBody([
        { metadata: { backendUrn: "urn:li:activity:203" } },
      ]),
    );

    expect(result.posts[0]?.mediaType).toBeNull();
  });

  it("ignores content keys with null values for media type", () => {
    const result = parseProfileUpdatesResponse(
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

    expect(result.posts[0]?.mediaType).toBe("video");
  });

  it("handles empty elements array", () => {
    const result = parseProfileUpdatesResponse(graphqlBody([]));
    expect(result.posts).toHaveLength(0);
    expect(result.paging).toEqual({ start: 0, count: 0, total: 0 });
  });

  it("handles empty response", () => {
    const result = parseProfileUpdatesResponse({});
    expect(result.posts).toHaveLength(0);
  });

  it("handles elements with header but no author headline", () => {
    const result = parseProfileUpdatesResponse(
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

    expect(result.posts[0]?.authorName).toBe("Acme Corp");
    expect(result.posts[0]?.authorHeadline).toBeNull();
    expect(result.posts[0]?.authorProfileUrl).toBe("https://www.linkedin.com/company/acme/");
  });

  it("handles elements with no header at all", () => {
    const result = parseProfileUpdatesResponse(
      graphqlBody([
        { metadata: { backendUrn: "urn:li:activity:500" } },
      ]),
    );

    expect(result.posts[0]?.authorName).toBeNull();
    expect(result.posts[0]?.authorHeadline).toBeNull();
    expect(result.posts[0]?.authorProfileUrl).toBeNull();
  });

  it("defaults social counts to zero", () => {
    const result = parseProfileUpdatesResponse(
      graphqlBody([
        {
          metadata: { backendUrn: "urn:li:activity:700" },
          header: { text: { text: "Test" } },
        },
      ]),
    );

    expect(result.posts[0]?.reactionCount).toBe(0);
    expect(result.posts[0]?.commentCount).toBe(0);
    expect(result.posts[0]?.shareCount).toBe(0);
  });

  it("handles null text fields gracefully", () => {
    const result = parseProfileUpdatesResponse(
      graphqlBody([
        {
          metadata: { backendUrn: "urn:li:activity:800" },
        },
      ]),
    );

    expect(result.posts[0]?.text).toBeNull();
    expect(result.posts[0]?.authorName).toBeNull();
    expect(result.posts[0]?.authorPublicId).toBeNull();
    expect(result.posts[0]?.authorHeadline).toBeNull();
    expect(result.posts[0]?.timestamp).toBeNull();
  });
});

describe("getProfileActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("navigates to the profile recent-activity page", async () => {
    const { navigate } = setupMocks(graphqlBody([]));

    await getProfileActivity({ cdpPort: CDP_PORT, profile: "johndoe" });

    expect(navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/in/johndoe/recent-activity/all/",
    );
  });

  it("URL-encodes the profile public ID in the navigation URL", async () => {
    const { navigate } = setupMocks(graphqlBody([]));

    await getProfileActivity({
      cdpPort: CDP_PORT,
      profile: "https://www.linkedin.com/in/john%20doe",
    });

    expect(navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/in/john%20doe/recent-activity/all/",
    );
  });

  it("extracts profile ID from URL input for navigation", async () => {
    const { navigate } = setupMocks(graphqlBody([]));

    await getProfileActivity({
      cdpPort: CDP_PORT,
      profile: "https://www.linkedin.com/in/janedoe",
    });

    expect(navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/in/janedoe/recent-activity/all/",
    );
  });

  it("enables interceptor before navigation and disables after", async () => {
    const { enableMock, disableMock, navigate } = setupMocks(graphqlBody([]));

    await getProfileActivity({ cdpPort: CDP_PORT, profile: "johndoe" });

    expect(enableMock).toHaveBeenCalled();
    expect(disableMock).toHaveBeenCalled();

    const enableOrder = enableMock.mock.invocationCallOrder[0] as number;
    const navigateOrder = navigate.mock.invocationCallOrder[0] as number;
    const disableOrder = disableMock.mock.invocationCallOrder[0] as number;
    expect(enableOrder).toBeLessThan(navigateOrder);
    expect(navigateOrder).toBeLessThan(disableOrder);
  });

  it("waits for voyagerFeedDashProfileUpdates response", async () => {
    const { waitForResponseMock } = setupMocks(graphqlBody([]));

    await getProfileActivity({ cdpPort: CDP_PORT, profile: "johndoe" });

    expect(waitForResponseMock).toHaveBeenCalledWith(expect.any(Function));
    const filter = waitForResponseMock.mock.calls[0]?.[0] as (
      url: string,
    ) => boolean;
    expect(
      filter(
        "/voyager/api/graphql?queryId=voyagerFeedDashProfileUpdates.abc123&variables=...",
      ),
    ).toBe(true);
    expect(
      filter(
        "/voyager/api/graphql?queryId=voyagerFeedDashMainFeed.xyz&variables=...",
      ),
    ).toBe(false);
  });

  it("returns parsed posts with profilePublicId", async () => {
    setupMocks(
      graphqlBody(
        [
          {
            metadata: { backendUrn: "urn:li:activity:123" },
            header: { text: { text: "Jane Doe" } },
            commentary: { text: { text: "Hello world" } },
          },
        ],
        { start: 0, count: 20, total: 1 },
      ),
    );

    const result = await getProfileActivity({
      cdpPort: CDP_PORT,
      profile: "janedoe",
    });

    expect(result.profilePublicId).toBe("janedoe");
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.urn).toBe("urn:li:activity:123");
    expect(result.posts[0]?.text).toBe("Hello world");
    expect(result.paging).toEqual({ start: 0, count: 20, total: 1 });
  });

  it("throws on non-200 response", async () => {
    setupMocks(null, 400);

    await expect(
      getProfileActivity({ cdpPort: CDP_PORT, profile: "johndoe" }),
    ).rejects.toThrow("Voyager API returned HTTP 400 for profile activity");
  });

  it("throws on non-object response body", async () => {
    setupMocks(null, 200);

    await expect(
      getProfileActivity({ cdpPort: CDP_PORT, profile: "johndoe" }),
    ).rejects.toThrow(
      "Voyager API returned an unexpected response format for profile activity",
    );
  });

  it("throws when no LinkedIn page found", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([]);

    await expect(
      getProfileActivity({ cdpPort: CDP_PORT, profile: "johndoe" }),
    ).rejects.toThrow("No LinkedIn page found in LinkedHelper");
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      getProfileActivity({
        cdpPort: CDP_PORT,
        profile: "johndoe",
        cdpHost: "192.168.1.1",
      }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("disconnects CDP client after operation", async () => {
    const { disconnect } = setupMocks(graphqlBody([]));

    await getProfileActivity({ cdpPort: CDP_PORT, profile: "johndoe" });

    expect(disconnect).toHaveBeenCalled();
  });

  it("disconnects CDP client even on error", async () => {
    const { disconnect } = setupMocks(null, 500);

    await expect(
      getProfileActivity({ cdpPort: CDP_PORT, profile: "johndoe" }),
    ).rejects.toThrow();

    expect(disconnect).toHaveBeenCalled();
  });

  it("disables interceptor even on error", async () => {
    const { disableMock } = setupMocks(null, 500);

    await expect(
      getProfileActivity({ cdpPort: CDP_PORT, profile: "johndoe" }),
    ).rejects.toThrow();

    expect(disableMock).toHaveBeenCalled();
  });
});
