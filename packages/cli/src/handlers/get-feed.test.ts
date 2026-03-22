// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, getFeed: vi.fn() };
});

import { getFeed, type GetFeedOutput } from "@lhremote/core";
import { handleGetFeed } from "./get-feed.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: GetFeedOutput = {
  posts: [
    {
      urn: "urn:li:activity:123",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      authorName: "Alice Smith",
      authorPublicId: "alice",
      authorHeadline: "Engineer at Acme",
      authorProfileUrl: "https://www.linkedin.com/in/alice/",
      text: "Hello #linkedin world! This is a really long post that should be truncated in the human-readable output because it exceeds the maximum length limit we set for display",
      mediaType: "image",
      reactionCount: 10,
      commentCount: 3,
      shareCount: 1,
      timestamp: 1700000000000,
      hashtags: ["linkedin"],
    },
  ],
  nextCursor: "cursor-abc",
};

describe("handleGetFeed", () => {
  const originalExitCode = process.exitCode;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints JSON with --json", async () => {
    vi.mocked(getFeed).mockResolvedValue(MOCK_RESULT);

    await handleGetFeed({ json: true });

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.posts).toHaveLength(1);
    expect(output.posts[0].urn).toBe("urn:li:activity:123");
    expect(output.nextCursor).toBe("cursor-abc");
  });

  it("prints human-readable output by default", async () => {
    vi.mocked(getFeed).mockResolvedValue(MOCK_RESULT);

    await handleGetFeed({});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("Alice Smith");
    expect(output).toContain("Engineer at Acme");
    expect(output).toContain("Reactions: 10");
    expect(output).toContain("Comments: 3");
    expect(output).toContain("Shares: 1");
    expect(output).toContain("Media: image");
    expect(output).toContain("Tags: #linkedin");
    expect(output).toContain("Next cursor: cursor-abc");
  });

  it("truncates long text in human-readable output", async () => {
    vi.mocked(getFeed).mockResolvedValue(MOCK_RESULT);

    await handleGetFeed({});

    const output = getStdout(stdoutSpy);
    expect(output).toContain("...");
  });

  it("prints empty feed message when no posts", async () => {
    vi.mocked(getFeed).mockResolvedValue({ posts: [], nextCursor: null });

    await handleGetFeed({});

    const output = getStdout(stdoutSpy);
    expect(output).toContain("No posts found in feed.");
  });

  it("omits next cursor when null", async () => {
    vi.mocked(getFeed).mockResolvedValue({ posts: [], nextCursor: null });

    await handleGetFeed({});

    const output = getStdout(stdoutSpy);
    expect(output).not.toContain("Next cursor:");
  });

  it("passes count and cursor to operation", async () => {
    vi.mocked(getFeed).mockResolvedValue({ posts: [], nextCursor: null });

    await handleGetFeed({ count: 5, cursor: "my-cursor" });

    expect(getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ count: 5, cursor: "my-cursor" }),
    );
  });

  it("sets exitCode on error", async () => {
    vi.mocked(getFeed).mockRejectedValue(new Error("connection refused"));

    await handleGetFeed({});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("connection refused");
  });

  it("omits optional fields in human-readable output", async () => {
    vi.mocked(getFeed).mockResolvedValue({
      posts: [
        {
          urn: "urn:li:activity:999",
          url: "https://www.linkedin.com/feed/update/urn:li:activity:999/",
          authorName: "Jane Doe",
          authorPublicId: null,
          authorHeadline: null,
          authorProfileUrl: null,
          text: null,
          mediaType: null,
          reactionCount: 0,
          commentCount: 0,
          shareCount: 0,
          timestamp: null,
          hashtags: [],
        },
      ],
      nextCursor: null,
    });

    await handleGetFeed({});

    const output = getStdout(stdoutSpy);
    expect(output).toContain("Jane Doe");
    expect(output).not.toContain("Media:");
    expect(output).not.toContain("Tags:");
    expect(output).not.toContain("Posted:");
  });
});
