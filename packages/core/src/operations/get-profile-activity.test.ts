// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import {
  extractProfileId,
  parseProfileUpdatesResponse,
} from "./get-profile-activity.js";

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
  it("parses elements from data wrapper", () => {
    const result = parseProfileUpdatesResponse({
      data: {
        elements: [
          {
            updateMetadata: {
              urn: "urn:li:activity:123",
              shareUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123",
            },
            commentary: { text: { text: "Hello world" } },
            actor: {
              name: { text: "Jane Doe" },
              publicIdentifier: "janedoe",
              description: { text: "Engineer at Acme" },
            },
            publishedAt: 1679000000000,
            socialDetail: {
              totalSocialActivityCounts: {
                numLikes: 10,
                numComments: 5,
                numShares: 2,
              },
            },
          },
        ],
        paging: { start: 0, count: 20, total: 1 },
      },
    });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toEqual({
      urn: "urn:li:activity:123",
      text: "Hello world",
      authorName: "Jane Doe",
      authorPublicId: "janedoe",
      authorHeadline: "Engineer at Acme",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:123",
      publishedAt: 1679000000000,
      reactionCount: 10,
      commentCount: 5,
      shareCount: 2,
    });
    expect(result.paging).toEqual({ start: 0, count: 20, total: 1 });
  });

  it("parses elements from top-level (no data wrapper)", () => {
    const result = parseProfileUpdatesResponse({
      elements: [
        {
          urn: "urn:li:activity:456",
          commentary: { text: { text: "Top-level element" } },
          actor: { name: { text: "Bob" }, publicIdentifier: "bob" },
        },
      ],
      paging: { start: 5, count: 10, total: 50 },
    });

    expect(result.posts).toHaveLength(1);
    const post = result.posts[0];
    expect(post?.urn).toBe("urn:li:activity:456");
    expect(post?.text).toBe("Top-level element");
    expect(result.paging).toEqual({ start: 5, count: 10, total: 50 });
  });

  it("skips elements without URN", () => {
    const result = parseProfileUpdatesResponse({
      elements: [
        { commentary: { text: { text: "No URN" } } },
        { urn: "urn:li:activity:789", commentary: { text: { text: "Has URN" } } },
      ],
    });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.urn).toBe("urn:li:activity:789");
  });

  it("resolves author from included entities via actor URN", () => {
    const result = parseProfileUpdatesResponse({
      elements: [
        {
          urn: "urn:li:activity:100",
          actor: { urn: "urn:li:fsd_profile:alice" },
        },
      ],
      included: [
        {
          entityUrn: "urn:li:fsd_profile:alice",
          firstName: "Alice",
          lastName: "Smith",
          publicIdentifier: "alicesmith",
          headline: { text: "PM at Corp" },
        },
      ],
    });

    expect(result.posts[0]?.authorName).toBe("Alice Smith");
    expect(result.posts[0]?.authorPublicId).toBe("alicesmith");
    expect(result.posts[0]?.authorHeadline).toBe("PM at Corp");
  });

  it("resolves author from included entities via *miniProfile ref", () => {
    const result = parseProfileUpdatesResponse({
      elements: [
        {
          urn: "urn:li:activity:200",
          actor: { "*miniProfile": "urn:li:fsd_profile:charlie" },
        },
      ],
      included: [
        {
          entityUrn: "urn:li:fsd_profile:charlie",
          firstName: "Charlie",
          lastName: "Brown",
          publicIdentifier: "charlieb",
          occupation: "Designer",
        },
      ],
    });

    expect(result.posts[0]?.authorName).toBe("Charlie Brown");
    expect(result.posts[0]?.authorPublicId).toBe("charlieb");
    expect(result.posts[0]?.authorHeadline).toBe("Designer");
  });

  it("falls back to resharedUpdate text", () => {
    const result = parseProfileUpdatesResponse({
      elements: [
        {
          urn: "urn:li:activity:300",
          resharedUpdate: {
            commentary: { text: { text: "Reshared post text" } },
          },
          actor: { name: { text: "Resharer" } },
        },
      ],
    });

    expect(result.posts[0]?.text).toBe("Reshared post text");
  });

  it("handles empty elements array", () => {
    const result = parseProfileUpdatesResponse({ elements: [] });
    expect(result.posts).toHaveLength(0);
    expect(result.paging).toEqual({ start: 0, count: 0, total: 0 });
  });

  it("handles empty response", () => {
    const result = parseProfileUpdatesResponse({});
    expect(result.posts).toHaveLength(0);
  });

  it("defaults social counts to zero when missing", () => {
    const result = parseProfileUpdatesResponse({
      elements: [
        {
          urn: "urn:li:activity:400",
          actor: { name: { text: "Test" } },
        },
      ],
    });

    expect(result.posts[0]?.reactionCount).toBe(0);
    expect(result.posts[0]?.commentCount).toBe(0);
    expect(result.posts[0]?.shareCount).toBe(0);
  });

  it("handles null text fields gracefully", () => {
    const result = parseProfileUpdatesResponse({
      elements: [
        {
          urn: "urn:li:activity:500",
          actor: {},
        },
      ],
    });

    expect(result.posts[0]?.text).toBeNull();
    expect(result.posts[0]?.authorName).toBeNull();
    expect(result.posts[0]?.authorPublicId).toBeNull();
    expect(result.posts[0]?.authorHeadline).toBeNull();
    expect(result.posts[0]?.url).toBeNull();
    expect(result.posts[0]?.publishedAt).toBeNull();
  });
});
