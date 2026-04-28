// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, reactToComment: vi.fn() };
});

import { reactToComment, type ReactToCommentOutput } from "@lhremote/core";
import { handleReactToComment } from "./react-to-comment.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const POST_URL = "https://www.linkedin.com/feed/update/urn:li:activity:123/";
const COMMENT_URN = "urn:li:comment:(activity:123,456)";

const MOCK_RESULT: ReactToCommentOutput = {
  success: true,
  postUrl: POST_URL,
  commentUrn: COMMENT_URN,
  reactionType: "like",
  alreadyReacted: false,
  currentReaction: null,
  dryRun: false,
};

describe("handleReactToComment", () => {
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
    vi.mocked(reactToComment).mockResolvedValue(MOCK_RESULT);

    await handleReactToComment(POST_URL, COMMENT_URN, { json: true });

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.postUrl).toBe(POST_URL);
    expect(output.commentUrn).toBe(COMMENT_URN);
    expect(output.reactionType).toBe("like");
  });

  it("prints human-readable output", async () => {
    vi.mocked(reactToComment).mockResolvedValue(MOCK_RESULT);

    await handleReactToComment(POST_URL, COMMENT_URN, {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain('Reacted to comment with "like"');
    expect(output).toContain(POST_URL);
    expect(output).toContain(COMMENT_URN);
  });

  it("prints already-reacted output when alreadyReacted is true", async () => {
    vi.mocked(reactToComment).mockResolvedValue({
      ...MOCK_RESULT,
      alreadyReacted: true,
    });

    await handleReactToComment(POST_URL, COMMENT_URN, {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain('Already reacted to comment with "like"');
    expect(output).toContain("no change");
  });

  it("prints [dry-run] prefix in human-readable mode", async () => {
    vi.mocked(reactToComment).mockResolvedValue({
      ...MOCK_RESULT,
      dryRun: true,
    });

    await handleReactToComment(POST_URL, COMMENT_URN, { dryRun: true });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("[dry-run]");
    expect(output).toContain('Would react to comment with "like"');
  });

  it("prints [dry-run] already-reacted output", async () => {
    vi.mocked(reactToComment).mockResolvedValue({
      ...MOCK_RESULT,
      alreadyReacted: true,
      currentReaction: "like",
      dryRun: true,
    });

    await handleReactToComment(POST_URL, COMMENT_URN, { dryRun: true });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("[dry-run]");
    expect(output).toContain('Already reacted to comment with "like"');
  });

  it("sets exitCode on error", async () => {
    vi.mocked(reactToComment).mockRejectedValue(new Error("connection refused"));

    await handleReactToComment(POST_URL, COMMENT_URN, {});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("connection refused");
  });
});
