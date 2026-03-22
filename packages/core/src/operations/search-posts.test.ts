// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import {
  extractActivityUrn,
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

describe("parseSearchResponse", () => {
  it("returns empty results for empty response", () => {
    const result = parseSearchResponse({});
    expect(result.posts).toEqual([]);
    expect(result.paging).toEqual({ start: 0, count: 0, total: 0 });
  });

  it("parses a single post result from GraphQL response", () => {
    const result = parseSearchResponse({
      data: {
        searchDashClustersByAll: {
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

  it("handles fs_updateV2 entity URNs", () => {
    const result = parseSearchResponse({
      data: {
        searchDashClustersByAll: {
          elements: [
            {
              items: [
                {
                  item: {
                    entityResult: {
                      entityUrn:
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
      },
    });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toEqual({
      postUrn: "urn:li:activity:1234567890",
      text: "Great post about tech",
      authorFirstName: "John",
      authorLastName: "Doe",
      authorPublicId: null,
      authorHeadline: null,
      reactionCount: 0,
      commentCount: 0,
    });
  });

  it("returns empty results when no collection present", () => {
    const result = parseSearchResponse({
      data: {},
    });

    expect(result.posts).toEqual([]);
    expect(result.paging).toEqual({ start: 0, count: 0, total: 0 });
  });

  it("skips items without entityResult", () => {
    const result = parseSearchResponse({
      data: {
        searchDashClustersByAll: {
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
      },
    });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.postUrn).toBe("urn:li:activity:111");
  });

  it("handles multiple clusters with multiple items", () => {
    const result = parseSearchResponse({
      data: {
        searchDashClustersByAll: {
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
      },
    });

    expect(result.posts).toHaveLength(3);
    expect(result.posts.map((p) => p.postUrn)).toEqual([
      "urn:li:activity:111",
      "urn:li:activity:222",
      "urn:li:activity:333",
    ]);
  });

  it("defaults paging when missing", () => {
    const result = parseSearchResponse({
      data: {
        searchDashClustersByAll: {
          elements: [
            {
              items: [
                {
                  item: {
                    entityResult: {
                      entityUrn: "urn:li:activity:999",
                      title: { text: "Someone" },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    });

    expect(result.posts).toHaveLength(1);
    expect(result.paging).toEqual({ start: 0, count: 1, total: 1 });
  });
});
