// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, getPost: vi.fn() };
});

import { getPost, type GetPostOutput } from "@lhremote/core";
import { handleGetPost } from "./get-post.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: GetPostOutput = {
  post: {
    postUrn: "urn:li:activity:7123456789012345678",
    authorName: "Alice Smith",
    authorHeadline: "Engineer at Acme",
    authorPublicId: "alicesmith",
    text: "Hello world",
    publishedAt: 1700000000000,
    reactionCount: 10,
    commentCount: 3,
    shareCount: 1,
  },
  comments: [
    {
      commentUrn: "urn:li:comment:1",
      authorName: "Bob",
      authorHeadline: "PM at Acme",
      authorPublicId: "bob",
      text: "Nice!",
      createdAt: 1700001000000,
      reactionCount: 2,
    },
  ],
  commentsPaging: { start: 0, count: 100, total: 1 },
};

describe("handleGetPost", () => {
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
    vi.mocked(getPost).mockResolvedValue(MOCK_RESULT);

    await handleGetPost(
      "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      { json: true },
    );

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.post.postUrn).toBe("urn:li:activity:7123456789012345678");
    expect(output.comments).toHaveLength(1);
    expect(output.commentsPaging.total).toBe(1);
  });

  it("prints human-readable output with post details", async () => {
    vi.mocked(getPost).mockResolvedValue(MOCK_RESULT);

    await handleGetPost(
      "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      {},
    );

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("urn:li:activity:7123456789012345678");
    expect(output).toContain("Alice Smith");
    expect(output).toContain("Engineer at Acme");
    expect(output).toContain("Published:");
    expect(output).toContain("Hello world");
    expect(output).toContain("Reactions: 10");
    expect(output).toContain("Comments:  3");
    expect(output).toContain("Shares:    1");
  });

  it("formats comments section with paging", async () => {
    vi.mocked(getPost).mockResolvedValue(MOCK_RESULT);

    await handleGetPost(
      "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      {},
    );

    const output = getStdout(stdoutSpy);
    expect(output).toContain("Comments (1\u20131 of 1):");
    expect(output).toContain("Bob");
    expect(output).toContain("Nice!");
  });

  it("shows singular reaction count for comments", async () => {
    vi.mocked(getPost).mockResolvedValue({
      ...MOCK_RESULT,
      comments: [
        {
          commentUrn: "urn:li:comment:1",
          authorName: "Bob",
          authorHeadline: "PM at Acme",
          authorPublicId: "bob",
          text: "Nice!",
          createdAt: 1700001000000,
          reactionCount: 1,
        },
      ],
    });

    await handleGetPost(
      "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      {},
    );

    const output = getStdout(stdoutSpy);
    expect(output).toContain("[1 reaction]");
    expect(output).not.toContain("[1 reactions]");
  });

  it("shows plural reaction count for comments", async () => {
    vi.mocked(getPost).mockResolvedValue(MOCK_RESULT);

    await handleGetPost(
      "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      {},
    );

    const output = getStdout(stdoutSpy);
    expect(output).toContain("[2 reactions]");
  });

  it("does not show comments section when empty", async () => {
    vi.mocked(getPost).mockResolvedValue({
      ...MOCK_RESULT,
      comments: [],
      commentsPaging: { start: 0, count: 100, total: 0 },
    });

    await handleGetPost(
      "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      {},
    );

    const output = getStdout(stdoutSpy);
    expect(output).not.toContain("Comments (");
  });

  it("sets exitCode on error", async () => {
    vi.mocked(getPost).mockRejectedValue(new Error("connection refused"));

    await handleGetPost(
      "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      {},
    );

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("connection refused");
  });
});
