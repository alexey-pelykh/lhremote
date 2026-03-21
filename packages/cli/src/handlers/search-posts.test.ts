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
      postUrn: "urn:li:activity:7123456789012345678",
      text: "Excited about AI agents!",
      authorFirstName: "Jane",
      authorLastName: "Smith",
      authorPublicId: "janesmith",
      authorHeadline: "CEO at Acme Corp",
      reactionCount: 42,
      commentCount: 7,
    },
    {
      postUrn: "urn:li:activity:7234567890123456789",
      text: null,
      authorFirstName: "Bob",
      authorLastName: null,
      authorPublicId: null,
      authorHeadline: null,
      reactionCount: 0,
      commentCount: 0,
    },
  ],
  paging: { start: 0, count: 10, total: 42 },
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
    expect(output.paging.total).toBe(42);
  });

  it("prints human-readable output by default", async () => {
    vi.mocked(searchPosts).mockResolvedValue(MOCK_RESULTS);

    await handleSearchPosts("AI agents", {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain('"AI agents"');
    expect(output).toContain("42 results");
    expect(output).toContain("Jane Smith");
    expect(output).toContain("janesmith");
    expect(output).toContain("CEO at Acme Corp");
    expect(output).toContain("Excited about AI agents!");
    expect(output).toContain("Reactions: 42");
    expect(output).toContain("Comments: 7");
  });

  it("shows pagination hint when more results available", async () => {
    vi.mocked(searchPosts).mockResolvedValue(MOCK_RESULTS);

    await handleSearchPosts("AI agents", {});

    const output = getStdout(stdoutSpy);
    expect(output).toContain("--start 2");
  });

  it("handles empty results", async () => {
    vi.mocked(searchPosts).mockResolvedValue({
      query: "nonexistent",
      posts: [],
      paging: { start: 0, count: 10, total: 0 },
    });

    await handleSearchPosts("nonexistent", {});

    const output = getStdout(stdoutSpy);
    expect(output).toContain("No posts found");
  });

  it("passes pagination options to operation", async () => {
    vi.mocked(searchPosts).mockResolvedValue(MOCK_RESULTS);

    await handleSearchPosts("AI agents", { start: 10, count: 5 });

    expect(searchPosts).toHaveBeenCalledWith(
      expect.objectContaining({ query: "AI agents", start: 10, count: 5 }),
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
