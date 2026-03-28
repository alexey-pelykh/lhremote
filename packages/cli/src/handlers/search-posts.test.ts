// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    searchPosts: vi.fn(),
  };
});

import { type SearchPostsOutput, searchPosts } from "@lhremote/core";
import { handleSearchPosts } from "./search-posts.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULTS: SearchPostsOutput = {
  query: "AI agents",
  posts: [
    {
      url: "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      authorName: "Jane Smith",
      authorHeadline: "CEO at Acme Corp",
      authorProfileUrl: "https://www.linkedin.com/in/janesmith",
      authorPublicId: null,
      text: "Excited about AI agents!",
      mediaType: null,
      reactionCount: 42,
      commentCount: 7,
      shareCount: 3,
      timestamp: null,
      hashtags: [],
    },
    {
      url: "https://www.linkedin.com/feed/update/urn:li:activity:7234567890123456789/",
      authorName: "Bob",
      authorHeadline: null,
      authorProfileUrl: null,
      authorPublicId: null,
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
};

describe("handleSearchPosts", () => {
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
    vi.mocked(searchPosts).mockResolvedValue(MOCK_RESULTS);

    await handleSearchPosts("AI agents", { json: true });

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.query).toBe("AI agents");
    expect(output.posts).toHaveLength(2);
    expect(output.nextCursor).toBeNull();
  });

  it("prints human-readable output by default", async () => {
    vi.mocked(searchPosts).mockResolvedValue(MOCK_RESULTS);

    await handleSearchPosts("AI agents", {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain('"AI agents"');
    expect(output).toContain("Jane Smith");
    expect(output).toContain("CEO at Acme Corp");
    expect(output).toContain("Excited about AI agents!");
    expect(output).toContain("Reactions: 42");
    expect(output).toContain("Comments: 7");
    expect(output).toContain("Reposts: 3");
  });

  it("does not show pagination hint when nextCursor is null", async () => {
    vi.mocked(searchPosts).mockResolvedValue(MOCK_RESULTS);

    await handleSearchPosts("AI agents", {});

    const output = getStdout(stdoutSpy);
    expect(output).not.toContain("--cursor");
  });

  it("handles empty results", async () => {
    vi.mocked(searchPosts).mockResolvedValue({
      query: "nonexistent",
      posts: [],
      nextCursor: null,
    });

    await handleSearchPosts("nonexistent", {});

    const output = getStdout(stdoutSpy);
    expect(output).toContain("No posts found");
  });

  it("passes pagination options to operation", async () => {
    vi.mocked(searchPosts).mockResolvedValue(MOCK_RESULTS);

    await handleSearchPosts("AI agents", { cursor: 10, count: 5 });

    expect(searchPosts).toHaveBeenCalledWith(
      expect.objectContaining({ query: "AI agents", cursor: 10, count: 5 }),
    );
  });

  it("sets exitCode on error", async () => {
    vi.mocked(searchPosts).mockRejectedValue(
      new Error("connection refused"),
    );

    await handleSearchPosts("AI agents", {});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("connection refused");
  });
});
