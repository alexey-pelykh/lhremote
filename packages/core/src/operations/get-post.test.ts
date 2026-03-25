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

vi.mock("./navigate-away.js", () => ({
  navigateAwayIf: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./get-feed.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import { VoyagerInterceptor } from "../voyager/interceptor.js";
import {
  getPost,
  parseCommentsResponse,
  parseFeedUpdateResponse,
  resolveTextValue,
} from "./get-post.js";

describe("resolveTextValue", () => {
  it("returns empty string for undefined", () => {
    expect(resolveTextValue(undefined)).toBe("");
  });

  it("returns empty string for null", () => {
    expect(resolveTextValue(null)).toBe("");
  });

  it("returns string value as-is", () => {
    expect(resolveTextValue("hello")).toBe("hello");
  });

  it("extracts text from object with text field", () => {
    expect(resolveTextValue({ text: "hello" })).toBe("hello");
  });

  it("returns empty string for object without text field", () => {
    expect(resolveTextValue({})).toBe("");
  });
});

describe("parseFeedUpdateResponse", () => {
  const postUrn = "urn:li:activity:1234567890";

  it("parses flat response with inline actor", () => {
    const raw = {
      actor: {
        name: { text: "John Doe" },
        description: { text: "Software Engineer" },
        navigationUrl: "https://www.linkedin.com/in/johndoe",
      },
      commentary: { text: { text: "Hello world!" } },
      publishedAt: 1700000000000,
      socialDetail: {
        totalSocialActivityCounts: {
          numLikes: 42,
          numComments: 5,
          numShares: 3,
        },
      },
    };

    const result = parseFeedUpdateResponse(raw, postUrn, []);
    expect(result).toEqual({
      postUrn,
      authorName: "John Doe",
      authorHeadline: "Software Engineer",
      authorPublicId: "johndoe",
      text: "Hello world!",
      publishedAt: 1700000000000,
      reactionCount: 42,
      commentCount: 5,
      shareCount: 3,
    });
  });

  it("parses nested data response", () => {
    const raw = {
      data: {
        actor: {
          name: { text: "Jane Smith" },
          description: { text: "Product Manager" },
          publicIdentifier: "janesmith",
        },
        commentary: { text: { text: "Great post!" } },
        publishedAt: 1700001000000,
        socialDetail: {
          totalSocialActivityCounts: {
            numLikes: 10,
            numComments: 2,
            numShares: 1,
          },
        },
      },
    };

    const result = parseFeedUpdateResponse(raw, postUrn, []);
    expect(result.authorName).toBe("Jane Smith");
    expect(result.authorPublicId).toBe("janesmith");
    expect(result.text).toBe("Great post!");
    expect(result.publishedAt).toBe(1700001000000);
  });

  it("parses data.elements array response", () => {
    const raw = {
      data: {
        elements: [
          {
            actor: {
              name: { text: "Bob Johnson" },
              description: { text: "Developer" },
            },
            commentary: { text: { text: "First element" } },
            publishedAt: 1700002000000,
            socialDetail: {
              totalSocialActivityCounts: {
                numLikes: 5,
                numComments: 1,
                numShares: 0,
              },
            },
          },
        ],
      },
    };

    const result = parseFeedUpdateResponse(raw, postUrn, []);
    expect(result.authorName).toBe("Bob Johnson");
    expect(result.text).toBe("First element");
  });

  it("resolves actor from URN reference via included", () => {
    const actorUrn = "urn:li:member:999";
    const raw = {
      data: {
        actor: actorUrn as unknown as undefined,
        commentary: { text: { text: "Referenced actor" } },
      },
    };

    const included = [
      {
        entityUrn: actorUrn,
        firstName: "Alice",
        lastName: "Williams",
        publicIdentifier: "alicew",
        headline: { text: "Engineer" },
      },
    ];

    const result = parseFeedUpdateResponse(
      raw as unknown as Parameters<typeof parseFeedUpdateResponse>[0],
      postUrn,
      included,
    );
    expect(result.authorName).toBe("Alice Williams");
    expect(result.authorPublicId).toBe("alicew");
    expect(result.authorHeadline).toBe("Engineer");
  });

  it("resolves actor from *actor URN reference", () => {
    const actorUrn = "urn:li:member:888";
    const raw = {
      data: {
        "*actor": actorUrn,
        commentary: { text: { text: "Star actor ref" } },
      },
    };

    const included = [
      {
        entityUrn: actorUrn,
        name: { text: "Star Actor" },
        description: { text: "CTO" },
        navigationUrl: "https://www.linkedin.com/in/staractor",
      },
    ];

    const result = parseFeedUpdateResponse(raw, postUrn, included);
    expect(result.authorName).toBe("Star Actor");
    expect(result.authorPublicId).toBe("staractor");
  });

  it("handles missing optional fields gracefully", () => {
    const raw = {};
    const result = parseFeedUpdateResponse(raw, postUrn, []);

    expect(result.postUrn).toBe(postUrn);
    expect(result.authorName).toBe("");
    expect(result.authorHeadline).toBeNull();
    expect(result.authorPublicId).toBeNull();
    expect(result.text).toBe("");
    expect(result.publishedAt).toBeNull();
    expect(result.reactionCount).toBe(0);
    expect(result.commentCount).toBe(0);
    expect(result.shareCount).toBe(0);
  });

  it("handles string commentary text", () => {
    const raw = {
      commentary: { text: "Plain string text" },
    };
    const result = parseFeedUpdateResponse(raw, postUrn, []);
    expect(result.text).toBe("Plain string text");
  });

  it("resolves actor with firstName/lastName pattern", () => {
    const raw = {
      actor: {
        firstName: "First",
        lastName: "Last",
        headline: { text: "Title" },
        publicIdentifier: "firstlast",
      },
    };

    const result = parseFeedUpdateResponse(raw, postUrn, []);
    expect(result.authorName).toBe("First Last");
    expect(result.authorPublicId).toBe("firstlast");
    expect(result.authorHeadline).toBe("Title");
  });
});

describe("parseCommentsResponse", () => {
  it("parses comments with inline commenter", () => {
    const raw = {
      elements: [
        {
          urn: "urn:li:comment:100",
          commenter: {
            firstName: "Alice",
            lastName: "Smith",
            publicIdentifier: "alices",
            headline: { text: "Engineer" },
          },
          commentV2: { text: { text: "Nice post!" } },
          createdTime: 1700010000000,
          socialDetail: {
            totalSocialActivityCounts: { numLikes: 3 },
          },
        },
      ],
      paging: { start: 0, count: 10, total: 1 },
    };

    const result = parseCommentsResponse(raw);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toEqual({
      commentUrn: "urn:li:comment:100",
      authorName: "Alice Smith",
      authorHeadline: "Engineer",
      authorPublicId: "alices",
      text: "Nice post!",
      createdAt: 1700010000000,
      reactionCount: 3,
    });
    expect(result.paging).toEqual({ start: 0, count: 10, total: 1 });
  });

  it("parses nested data.elements response", () => {
    const raw = {
      data: {
        elements: [
          {
            entityUrn: "urn:li:comment:200",
            commenter: {
              firstName: "Bob",
              lastName: "Jones",
            },
            commentary: { text: { text: "Commentary format" } },
            createdTime: 1700020000000,
          },
        ],
        paging: { start: 0, count: 5, total: 1 },
      },
    };

    const result = parseCommentsResponse(raw);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]?.text).toBe("Commentary format");
    expect(result.comments[0]?.commentUrn).toBe("urn:li:comment:200");
    expect(result.paging).toEqual({ start: 0, count: 5, total: 1 });
  });

  it("resolves commenter from included via URN reference", () => {
    const commenterUrn = "urn:li:member:555";
    const raw = {
      elements: [
        {
          urn: "urn:li:comment:300",
          commenterUrn,
          commentV2: { text: { text: "Looked up commenter" } },
          createdTime: 1700030000000,
        },
      ],
      included: [
        {
          entityUrn: commenterUrn,
          firstName: "Charlie",
          lastName: "Brown",
          publicIdentifier: "charlieb",
          occupation: "Writer",
        },
      ],
    };

    const result = parseCommentsResponse(raw);
    expect(result.comments[0]?.authorName).toBe("Charlie Brown");
    expect(result.comments[0]?.authorPublicId).toBe("charlieb");
    expect(result.comments[0]?.authorHeadline).toBe("Writer");
  });

  it("resolves commenter from *commenter URN reference", () => {
    const commenterUrn = "urn:li:member:666";
    const raw = {
      elements: [
        {
          urn: "urn:li:comment:400",
          "*commenter": commenterUrn,
          commentV2: { text: { text: "Star commenter ref" } },
        },
      ],
      included: [
        {
          entityUrn: commenterUrn,
          firstName: "Dana",
          lastName: "White",
          headline: { text: "Manager" },
        },
      ],
    };

    const result = parseCommentsResponse(raw);
    expect(result.comments[0]?.authorName).toBe("Dana White");
    expect(result.comments[0]?.authorHeadline).toBe("Manager");
  });

  it("handles plain string comment text", () => {
    const raw = {
      elements: [
        {
          comment: "Simple string comment",
        },
      ],
    };

    const result = parseCommentsResponse(raw);
    expect(result.comments[0]?.text).toBe("Simple string comment");
  });

  it("handles comment with text object", () => {
    const raw = {
      elements: [
        {
          comment: { text: "Object text comment" },
        },
      ],
    };

    const result = parseCommentsResponse(raw);
    expect(result.comments[0]?.text).toBe("Object text comment");
  });

  it("handles comment with values array", () => {
    const raw = {
      elements: [
        {
          comment: { values: [{ value: "Part 1" }, { value: " Part 2" }] },
        },
      ],
    };

    const result = parseCommentsResponse(raw);
    expect(result.comments[0]?.text).toBe("Part 1 Part 2");
  });

  it("handles created.time timestamp variant", () => {
    const raw = {
      elements: [
        {
          created: { time: 1700040000000 },
          commentV2: { text: "Nested time" },
        },
      ],
    };

    const result = parseCommentsResponse(raw);
    expect(result.comments[0]?.createdAt).toBe(1700040000000);
  });

  it("handles empty response gracefully", () => {
    const result = parseCommentsResponse({});
    expect(result.comments).toEqual([]);
    expect(result.paging).toEqual({ start: 0, count: 0, total: 0 });
  });

  it("handles missing optional fields", () => {
    const raw = {
      elements: [{}],
    };

    const result = parseCommentsResponse(raw);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toEqual({
      commentUrn: null,
      authorName: "",
      authorHeadline: null,
      authorPublicId: null,
      text: "",
      createdAt: null,
      reactionCount: 0,
    });
  });

  it("defaults paging from comment count when absent", () => {
    const raw = {
      elements: [{}, {}, {}],
    };

    const result = parseCommentsResponse(raw);
    expect(result.paging).toEqual({ start: 0, count: 3, total: 3 });
  });
});

describe("getPost", () => {
  const CDP_PORT = 9222;
  const POST_URL =
    "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/";

  function setupMocks(opts?: {
    responseStatus?: number;
    responseBody?: unknown;
    scrapedComments?: unknown[];
    loadMoreResult?: boolean;
    commentResponses?: Array<{ status: number; body: unknown }>;
  }) {
    const {
      responseStatus = 200,
      responseBody = {},
      scrapedComments = [],
      loadMoreResult = false,
      commentResponses = [],
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

    const evaluate = vi.fn();
    evaluate.mockImplementation((script: string) => {
      if (script.includes("comments-comment-item")) {
        return Promise.resolve(scrapedComments);
      }
      if (script.includes("load-more-comments")) {
        return Promise.resolve(loadMoreResult);
      }
      return Promise.resolve(null);
    });

    const navigate = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect,
        navigate,
        evaluate,
      } as unknown as CDPClient;
    });

    const enable = vi.fn().mockResolvedValue(undefined);
    const disable = vi.fn().mockResolvedValue(undefined);

    // First call returns the post detail response; subsequent calls return
    // comment-loading responses (or reject to simulate timeout).
    const waitForResponse = vi.fn();
    waitForResponse.mockResolvedValueOnce({
      url: "/voyager/api/feed/updates/urn%3Ali%3Aactivity%3A1234567890",
      status: responseStatus,
      body: responseBody,
    });
    for (const cr of commentResponses) {
      waitForResponse.mockResolvedValueOnce({
        url: "/voyager/api/feed/dash/feedComments",
        status: cr.status,
        body: cr.body,
      });
    }
    // Any further calls (e.g. when load-more clicks but no response configured)
    // should reject (simulating timeout)
    waitForResponse.mockRejectedValue(new Error("Timeout"));

    vi.mocked(VoyagerInterceptor).mockImplementation(function () {
      return {
        enable,
        disable,
        waitForResponse,
      } as unknown as VoyagerInterceptor;
    });

    return { enable, disable, waitForResponse, navigate, disconnect, evaluate };
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

  it("uses passive interception pattern", async () => {
    const { enable, disable, waitForResponse, navigate } = setupMocks({
      responseBody: {
        actor: {
          name: { text: "John Doe" },
          description: { text: "Software Engineer" },
        },
        commentary: { text: { text: "Hello world!" } },
        publishedAt: 1700000000000,
        socialDetail: {
          totalSocialActivityCounts: {
            numLikes: 42,
            numComments: 5,
            numShares: 3,
          },
        },
      },
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(enable).toHaveBeenCalled();
    expect(waitForResponse).toHaveBeenCalledWith(expect.any(Function));
    expect(navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/",
    );
    expect(disable).toHaveBeenCalled();

    expect(result.post.postUrn).toBe("urn:li:activity:1234567890");
    expect(result.post.authorName).toBe("John Doe");
    expect(result.post.text).toBe("Hello world!");
    expect(result.post.reactionCount).toBe(42);
  });

  it("waitForResponse filter matches /feed/updates/ URLs", async () => {
    const { waitForResponse } = setupMocks();

    await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    const call = waitForResponse.mock.calls[0];
    expect(call).toBeDefined();
    const filter = (call as unknown[])[0] as (url: string) => boolean;
    expect(filter("/voyager/api/feed/updates/urn%3Ali%3Aactivity%3A123")).toBe(
      true,
    );
    expect(filter("/voyager/api/feed/dash/feedSocialDetails")).toBe(false);
    expect(filter("/voyager/api/other-endpoint")).toBe(false);
  });

  it("scrapes initial comments from the DOM", async () => {
    setupMocks({
      scrapedComments: [
        {
          authorName: "Alice Smith",
          authorHeadline: "Engineer",
          authorPublicId: "alices",
          text: "Great post!",
          createdAt: 1700010000000,
          reactionCount: 3,
        },
      ],
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]?.text).toBe("Great post!");
    expect(result.comments[0]?.authorName).toBe("Alice Smith");
  });

  it("returns empty comments when none found in DOM", async () => {
    setupMocks({ scrapedComments: [] });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });
    expect(result.comments).toEqual([]);
  });

  it("limits comments to commentCount", async () => {
    setupMocks({
      scrapedComments: [
        { authorName: "A", authorHeadline: null, authorPublicId: null, text: "1", createdAt: null, reactionCount: 0 },
        { authorName: "B", authorHeadline: null, authorPublicId: null, text: "2", createdAt: null, reactionCount: 0 },
        { authorName: "C", authorHeadline: null, authorPublicId: null, text: "3", createdAt: null, reactionCount: 0 },
      ],
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT, commentCount: 2 });
    expect(result.comments).toHaveLength(2);
  });

  it("intercepts comment responses on load-more click", async () => {
    setupMocks({
      scrapedComments: [
        { authorName: "A", authorHeadline: null, authorPublicId: null, text: "initial", createdAt: null, reactionCount: 0 },
      ],
      loadMoreResult: true,
      commentResponses: [
        {
          status: 200,
          body: {
            elements: [
              {
                urn: "urn:li:comment:200",
                commenter: { firstName: "Bob", lastName: "Jones" },
                commentV2: { text: { text: "loaded more!" } },
                createdTime: 1700020000000,
              },
            ],
          },
        },
      ],
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT, commentCount: 5 });

    // Initial DOM comment + intercepted load-more comment
    expect(result.comments.length).toBeGreaterThanOrEqual(2);
    expect(result.comments.some((c) => c.text === "loaded more!")).toBe(true);
  });

  it("falls back to DOM scraping when interception times out", async () => {
    setupMocks({
      scrapedComments: [
        { authorName: "A", authorHeadline: null, authorPublicId: null, text: "dom-only", createdAt: null, reactionCount: 0 },
      ],
      loadMoreResult: true,
      // No commentResponses → waitForResponse will reject (timeout)
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT, commentCount: 5 });

    // Should still return DOM-scraped comments despite interception timeout
    expect(result.comments.length).toBeGreaterThanOrEqual(1);
    expect(result.comments[0]?.text).toBe("dom-only");
  });

  it("throws on non-200 response for post detail", async () => {
    setupMocks({ responseStatus: 403 });

    await expect(getPost({ postUrl: POST_URL, cdpPort: CDP_PORT })).rejects.toThrow(
      "Voyager API returned HTTP 403 for post detail",
    );
  });

  it("throws on non-object response body for post detail", async () => {
    setupMocks({ responseBody: null });

    await expect(getPost({ postUrl: POST_URL, cdpPort: CDP_PORT })).rejects.toThrow(
      "Voyager API returned an unexpected response format for post detail",
    );
  });

  it("disconnects CDP client after successful operation", async () => {
    const { disconnect } = setupMocks();

    await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(disconnect).toHaveBeenCalled();
  });

  it("disconnects CDP client and disables interception even on error", async () => {
    const { disconnect, disable } = setupMocks({ responseStatus: 500 });

    await expect(getPost({ postUrl: POST_URL, cdpPort: CDP_PORT })).rejects.toThrow();

    expect(disable).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });
});
