// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import {
  extractActivityUrn,
  extractPublicId,
  parseSearchResponse,
} from "./search-posts.js";

describe("extractActivityUrn", () => {
  it("returns null for undefined", () => {
    expect(extractActivityUrn(undefined)).toBeNull();
  });

  it("passes through a direct activity URN", () => {
    expect(extractActivityUrn("urn:li:activity:7123456789012345678")).toBe(
      "urn:li:activity:7123456789012345678",
    );
  });

  it("passes through a direct ugcPost URN", () => {
    expect(extractActivityUrn("urn:li:ugcPost:7123456789012345678")).toBe(
      "urn:li:ugcPost:7123456789012345678",
    );
  });

  it("extracts activity URN from fs_updateV2 wrapper", () => {
    expect(
      extractActivityUrn(
        "urn:li:fs_updateV2:(urn:li:activity:7123456789012345678,FEED_DETAIL)",
      ),
    ).toBe("urn:li:activity:7123456789012345678");
  });

  it("extracts ugcPost URN from fs_updateV2 wrapper", () => {
    expect(
      extractActivityUrn(
        "urn:li:fs_updateV2:(urn:li:ugcPost:7123456789012345678,FEED_DETAIL)",
      ),
    ).toBe("urn:li:ugcPost:7123456789012345678");
  });

  it("returns unknown URN as-is", () => {
    expect(extractActivityUrn("urn:li:other:123")).toBe("urn:li:other:123");
  });
});

describe("extractPublicId", () => {
  it("returns null for undefined", () => {
    expect(extractPublicId(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractPublicId("")).toBeNull();
  });

  it("extracts public ID from profile URL", () => {
    expect(
      extractPublicId("https://www.linkedin.com/in/johndoe"),
    ).toBe("johndoe");
  });

  it("extracts public ID from profile URL with query params", () => {
    expect(
      extractPublicId(
        "https://www.linkedin.com/in/johndoe?miniProfileUrn=urn%3Ali%3Afs_miniProfile",
      ),
    ).toBe("johndoe");
  });

  it("returns null for non-profile URL", () => {
    expect(extractPublicId("https://www.linkedin.com/company/foo")).toBeNull();
  });
});

describe("parseSearchResponse", () => {
  it("returns empty results for empty response", () => {
    const result = parseSearchResponse({});
    expect(result.posts).toEqual([]);
    expect(result.paging).toEqual({ start: 0, count: 0, total: 0 });
  });

  it("parses a single post result from nested data structure", () => {
    const result = parseSearchResponse({
      data: {
        elements: [
          {
            items: [
              {
                item: {
                  entityResult: {
                    entityUrn: "urn:li:activity:7123456789012345678",
                    title: { text: "Jane Smith" },
                    primarySubtitle: { text: "CEO at Acme Corp" },
                    summary: { text: "Excited about AI agents!" },
                  },
                },
              },
            ],
          },
        ],
        paging: { start: 0, count: 10, total: 42 },
      },
    });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toEqual({
      postUrn: "urn:li:activity:7123456789012345678",
      text: "Excited about AI agents!",
      authorFirstName: "Jane",
      authorLastName: "Smith",
      authorPublicId: null,
      authorHeadline: "CEO at Acme Corp",
      reactionCount: 0,
      commentCount: 0,
    });
    expect(result.paging).toEqual({ start: 0, count: 10, total: 42 });
  });

  it("resolves author from included entities", () => {
    const result = parseSearchResponse({
      data: {
        elements: [
          {
            items: [
              {
                item: {
                  entityResult: {
                    entityUrn:
                      "urn:li:fs_updateV2:(urn:li:activity:1234567890,FEED_DETAIL)",
                    "*entity":
                      "urn:li:fs_updateV2:(urn:li:activity:1234567890,FEED_DETAIL)",
                    title: { text: "John Doe" },
                    summary: { text: "Great post about tech" },
                  },
                },
              },
            ],
          },
        ],
        paging: { start: 0, count: 10, total: 1 },
      },
      included: [
        {
          $type: "com.linkedin.voyager.dash.feed.Update",
          entityUrn:
            "urn:li:fs_updateV2:(urn:li:activity:1234567890,FEED_DETAIL)",
          "*actor": "urn:li:fs_miniProfile:abc123",
          numLikes: 15,
          numComments: 3,
        },
        {
          $type: "com.linkedin.voyager.dash.identity.profile.Profile",
          entityUrn: "urn:li:fs_miniProfile:abc123",
          firstName: "John",
          lastName: "Doe",
          publicIdentifier: "johndoe",
          headline: { text: "Software Engineer" },
        },
      ],
    });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toEqual({
      postUrn: "urn:li:activity:1234567890",
      text: "Great post about tech",
      authorFirstName: "John",
      authorLastName: "Doe",
      authorPublicId: "johndoe",
      authorHeadline: "Software Engineer",
      reactionCount: 15,
      commentCount: 3,
    });
  });

  it("handles flat response structure (no data wrapper)", () => {
    const result = parseSearchResponse({
      elements: [
        {
          items: [
            {
              item: {
                entityResult: {
                  entityUrn: "urn:li:activity:9999999999",
                  title: { text: "Alice" },
                  summary: { text: "A post" },
                },
              },
            },
          ],
        },
      ],
      paging: { start: 5, count: 10, total: 50 },
    });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.postUrn).toBe("urn:li:activity:9999999999");
    expect(result.paging).toEqual({ start: 5, count: 10, total: 50 });
  });

  it("skips items without entityResult", () => {
    const result = parseSearchResponse({
      data: {
        elements: [
          {
            items: [
              { item: {} },
              {
                item: {
                  entityResult: {
                    entityUrn: "urn:li:activity:111",
                    title: { text: "Bob" },
                  },
                },
              },
            ],
          },
        ],
      },
    });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.postUrn).toBe("urn:li:activity:111");
  });

  it("extracts engagement counts from socialDetail", () => {
    const result = parseSearchResponse({
      data: {
        elements: [
          {
            items: [
              {
                item: {
                  entityResult: {
                    entityUrn: "urn:li:activity:555",
                    "*entity": "urn:li:update:555",
                  },
                },
              },
            ],
          },
        ],
      },
      included: [
        {
          entityUrn: "urn:li:update:555",
          socialDetail: {
            totalSocialActivityCounts: {
              numLikes: 42,
              numComments: 7,
            },
          },
        },
      ],
    });

    expect(result.posts[0]?.reactionCount).toBe(42);
    expect(result.posts[0]?.commentCount).toBe(7);
  });

  it("handles multiple clusters with multiple items", () => {
    const result = parseSearchResponse({
      data: {
        elements: [
          {
            items: [
              {
                item: {
                  entityResult: {
                    entityUrn: "urn:li:activity:111",
                    title: { text: "Author A" },
                  },
                },
              },
              {
                item: {
                  entityResult: {
                    entityUrn: "urn:li:activity:222",
                    title: { text: "Author B" },
                  },
                },
              },
            ],
          },
          {
            items: [
              {
                item: {
                  entityResult: {
                    entityUrn: "urn:li:activity:333",
                    title: { text: "Author C" },
                  },
                },
              },
            ],
          },
        ],
        paging: { start: 0, count: 10, total: 3 },
      },
    });

    expect(result.posts).toHaveLength(3);
    expect(result.posts.map((p) => p.postUrn)).toEqual([
      "urn:li:activity:111",
      "urn:li:activity:222",
      "urn:li:activity:333",
    ]);
  });
});
