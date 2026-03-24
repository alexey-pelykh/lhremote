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
import {
  extractPostUrn,
  getPostStats,
  parseFeedUpdateStatsResponse,
} from "./get-post-stats.js";

describe("extractPostUrn", () => {
  it("extracts URN from /feed/update/ URL with activity URN", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      ),
    ).toBe("urn:li:activity:7123456789012345678");
  });

  it("extracts URN from /feed/update/ URL with ugcPost URN", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:ugcPost:7123456789012345678/",
      ),
    ).toBe("urn:li:ugcPost:7123456789012345678");
  });

  it("extracts URN from /feed/update/ URL with share URN", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678/",
      ),
    ).toBe("urn:li:share:7123456789012345678");
  });

  it("extracts URN from /feed/update/ URL without trailing slash", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678",
      ),
    ).toBe("urn:li:activity:7123456789012345678");
  });

  it("extracts activity URN from /posts/ URL", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/posts/johndoe_activity-7123456789012345678-abcd/",
      ),
    ).toBe("urn:li:activity:7123456789012345678");
  });

  it("passes through raw URN input", () => {
    expect(extractPostUrn("urn:li:activity:7123456789012345678")).toBe(
      "urn:li:activity:7123456789012345678",
    );
  });

  it("passes through raw ugcPost URN", () => {
    expect(extractPostUrn("urn:li:ugcPost:7123456789012345678")).toBe(
      "urn:li:ugcPost:7123456789012345678",
    );
  });

  it("throws on unrecognised input", () => {
    expect(() => extractPostUrn("https://example.com/foo")).toThrow(
      "Cannot extract post URN from",
    );
  });

  it("throws on empty input", () => {
    expect(() => extractPostUrn("")).toThrow("Cannot extract post URN from");
  });
});

describe("parseFeedUpdateStatsResponse", () => {
  const postUrn = "urn:li:activity:1234567890";

  it("parses socialDetail.totalSocialActivityCounts with reactionTypeCounts", () => {
    const raw = {
      socialDetail: {
        totalSocialActivityCounts: {
          numLikes: 46,
          numComments: 5,
          numShares: 2,
          reactionTypeCounts: [
            { reactionType: "LIKE", count: 31 },
            { reactionType: "PRAISE", count: 11 },
            { reactionType: "EMPATHY", count: 4 },
          ],
        },
      },
    };

    const result = parseFeedUpdateStatsResponse(raw, postUrn);
    expect(result).toEqual({
      postUrn,
      reactionCount: 46,
      reactionsByType: [
        { type: "LIKE", count: 31 },
        { type: "PRAISE", count: 11 },
        { type: "EMPATHY", count: 4 },
      ],
      commentCount: 5,
      shareCount: 2,
    });
  });

  it("parses nested data.socialDetail variant", () => {
    const raw = {
      data: {
        socialDetail: {
          totalSocialActivityCounts: {
            numLikes: 100,
            numComments: 10,
            numShares: 5,
            reactionTypeCounts: [{ reactionType: "LIKE", count: 100 }],
          },
        },
      },
    };

    const result = parseFeedUpdateStatsResponse(raw, postUrn);
    expect(result.reactionCount).toBe(100);
    expect(result.reactionsByType).toEqual([{ type: "LIKE", count: 100 }]);
    expect(result.commentCount).toBe(10);
    expect(result.shareCount).toBe(5);
  });

  it("parses flat totalSocialActivityCounts variant", () => {
    const raw = {
      totalSocialActivityCounts: {
        numLikes: 20,
        numComments: 3,
        numShares: 1,
        reactionTypeCounts: [
          { reactionType: "LIKE", count: 15 },
          { reactionType: "INTEREST", count: 5 },
        ],
      },
    };

    const result = parseFeedUpdateStatsResponse(raw, postUrn);
    expect(result.reactionCount).toBe(20);
    expect(result.reactionsByType).toHaveLength(2);
  });

  it("parses data.totalSocialActivityCounts variant", () => {
    const raw = {
      data: {
        totalSocialActivityCounts: {
          numLikes: 7,
          numComments: 1,
          numShares: 0,
        },
      },
    };

    const result = parseFeedUpdateStatsResponse(raw, postUrn);
    expect(result.reactionCount).toBe(7);
    expect(result.reactionsByType).toEqual([]);
    expect(result.commentCount).toBe(1);
    expect(result.shareCount).toBe(0);
  });

  it("falls back to numLikes when reactionTypeCounts is absent", () => {
    const raw = {
      socialDetail: {
        totalSocialActivityCounts: {
          numLikes: 42,
          numComments: 3,
          numShares: 1,
        },
      },
    };

    const result = parseFeedUpdateStatsResponse(raw, postUrn);
    expect(result.reactionCount).toBe(42);
    expect(result.reactionsByType).toEqual([]);
  });

  it("filters out entries with missing reactionType or count", () => {
    const raw = {
      socialDetail: {
        totalSocialActivityCounts: {
          numLikes: 10,
          reactionTypeCounts: [
            { reactionType: "LIKE", count: 8 },
            { reactionType: undefined, count: 1 },
            { reactionType: "PRAISE", count: undefined },
            { reactionType: "EMPATHY", count: 2 },
          ] as Array<{ reactionType?: string; count?: number }>,
        },
      },
    };

    const result = parseFeedUpdateStatsResponse(raw, postUrn);
    expect(result.reactionsByType).toEqual([
      { type: "LIKE", count: 8 },
      { type: "EMPATHY", count: 2 },
    ]);
    expect(result.reactionCount).toBe(10);
  });

  it("handles empty response gracefully", () => {
    const result = parseFeedUpdateStatsResponse({}, postUrn);
    expect(result).toEqual({
      postUrn,
      reactionCount: 0,
      reactionsByType: [],
      commentCount: 0,
      shareCount: 0,
    });
  });
});

describe("getPostStats", () => {
  const CDP_PORT = 9222;
  const POST_URL =
    "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/";

  function setupMocks(opts?: {
    responseStatus?: number;
    responseBody?: unknown;
  }) {
    const { responseStatus = 200, responseBody = {} } = opts ?? {};

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

    const navigate = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect,
        navigate,
      } as unknown as CDPClient;
    });

    const enable = vi.fn().mockResolvedValue(undefined);
    const disable = vi.fn().mockResolvedValue(undefined);
    const waitForResponse = vi.fn().mockResolvedValue({
      url: "/voyager/api/feed/updates/urn%3Ali%3Aactivity%3A1234567890",
      status: responseStatus,
      body: responseBody,
    });

    vi.mocked(VoyagerInterceptor).mockImplementation(function () {
      return {
        enable,
        disable,
        waitForResponse,
      } as unknown as VoyagerInterceptor;
    });

    return { enable, disable, waitForResponse, navigate, disconnect };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      getPostStats({
        postUrl: POST_URL,
        cdpPort: CDP_PORT,
        cdpHost: "192.168.1.1",
      }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("throws when no LinkedIn page found", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([]);

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow("No LinkedIn page found in LinkedHelper");
  });

  it("uses passive interception pattern", async () => {
    const { enable, disable, waitForResponse, navigate } = setupMocks({
      responseBody: {
        socialDetail: {
          totalSocialActivityCounts: {
            numLikes: 10,
            numComments: 2,
            numShares: 1,
            reactionTypeCounts: [{ reactionType: "LIKE", count: 10 }],
          },
        },
      },
    });

    const result = await getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(enable).toHaveBeenCalled();
    expect(waitForResponse).toHaveBeenCalledWith(expect.any(Function));
    expect(navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/",
    );
    expect(disable).toHaveBeenCalled();

    expect(result.stats).toEqual({
      postUrn: "urn:li:activity:1234567890",
      reactionCount: 10,
      reactionsByType: [{ type: "LIKE", count: 10 }],
      commentCount: 2,
      shareCount: 1,
    });
  });

  it("waitForResponse filter matches /feed/updates/ URLs", async () => {
    const { waitForResponse } = setupMocks();

    await getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT });

    const call = waitForResponse.mock.calls[0];
    expect(call).toBeDefined();
    const filter = (call as unknown[])[0] as (url: string) => boolean;
    expect(filter("/voyager/api/feed/updates/urn%3Ali%3Aactivity%3A123")).toBe(
      true,
    );
    expect(filter("/voyager/api/feed/dash/feedSocialDetails")).toBe(false);
    expect(filter("/voyager/api/other-endpoint")).toBe(false);
  });

  it("throws on non-200 response", async () => {
    setupMocks({ responseStatus: 403 });

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow("Voyager API returned HTTP 403 for post stats");
  });

  it("throws on non-object response body", async () => {
    setupMocks({ responseBody: null });

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(
      "Voyager API returned an unexpected response format for post stats",
    );
  });

  it("disconnects CDP client after successful operation", async () => {
    const { disconnect } = setupMocks();

    await getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(disconnect).toHaveBeenCalled();
  });

  it("disconnects CDP client and disables interception even on error", async () => {
    const { disconnect, disable } = setupMocks({ responseStatus: 500 });

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow();

    expect(disable).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });
});
