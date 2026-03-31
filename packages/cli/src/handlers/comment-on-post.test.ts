// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, commentOnPost: vi.fn() };
});

import {
  BudgetExceededError,
  commentOnPost,
  type CommentOnPostOutput,
} from "@lhremote/core";
import { handleCommentOnPost } from "./comment-on-post.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: CommentOnPostOutput = {
  success: true,
  postUrl:
    "https://www.linkedin.com/feed/update/urn:li:activity:123/",
  commentText: "Great post!",
};

describe("handleCommentOnPost", () => {
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

  it("prints human-readable output on success", async () => {
    vi.mocked(commentOnPost).mockResolvedValue(MOCK_RESULT);

    await handleCommentOnPost({
      url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      text: "Great post!",
    });

    expect(process.exitCode).toBeUndefined();
    const stderr = getStderr(stderrSpy);
    expect(stderr).toContain("Posting comment...");
    expect(stderr).toContain("Done.");
    const stdout = getStdout(stdoutSpy);
    expect(stdout).toContain(
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
    );
    expect(stdout).toContain("Great post!");
  });

  it("prints JSON with --json", async () => {
    vi.mocked(commentOnPost).mockResolvedValue(MOCK_RESULT);

    await handleCommentOnPost({
      url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      text: "Great post!",
      json: true,
    });

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.postUrl).toBe(
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
    );
    expect(output.commentText).toBe("Great post!");
  });

  it("handles BudgetExceededError", async () => {
    vi.mocked(commentOnPost).mockRejectedValue(
      new BudgetExceededError("PostComment", 10, 10),
    );

    await handleCommentOnPost({
      url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      text: "Great post!",
    });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("PostComment");
  });

  it("sets exitCode on generic error", async () => {
    vi.mocked(commentOnPost).mockRejectedValue(
      new Error("connection refused"),
    );

    await handleCommentOnPost({
      url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      text: "Great post!",
    });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("connection refused");
  });
});
