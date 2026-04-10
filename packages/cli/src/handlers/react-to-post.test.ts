// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, reactToPost: vi.fn() };
});

import { reactToPost, type ReactToPostOutput } from "@lhremote/core";
import { handleReactToPost } from "./react-to-post.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: ReactToPostOutput = {
  success: true,
  postUrl:
    "https://www.linkedin.com/feed/update/urn:li:activity:123/",
  reactionType: "like",
  alreadyReacted: false,
  currentReaction: null,
  dryRun: false,
};

describe("handleReactToPost", () => {
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
    vi.mocked(reactToPost).mockResolvedValue(MOCK_RESULT);

    await handleReactToPost(
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      { json: true },
    );

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.postUrl).toBe(
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
    );
    expect(output.reactionType).toBe("like");
  });

  it("prints human-readable output", async () => {
    vi.mocked(reactToPost).mockResolvedValue(MOCK_RESULT);

    await handleReactToPost(
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      {},
    );

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain('Reacted to post with "like"');
    expect(output).toContain(
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
    );
  });

  it("prints already-reacted output when alreadyReacted is true", async () => {
    vi.mocked(reactToPost).mockResolvedValue({
      ...MOCK_RESULT,
      alreadyReacted: true,
    });

    await handleReactToPost(
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      {},
    );

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain('Already reacted to post with "like"');
    expect(output).toContain("no change");
  });

  it("prints [dry-run] prefix in human-readable mode", async () => {
    vi.mocked(reactToPost).mockResolvedValue({
      ...MOCK_RESULT,
      dryRun: true,
    });

    await handleReactToPost(
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      { dryRun: true },
    );

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("[dry-run]");
    expect(output).toContain('Would react to post with "like"');
  });

  it("prints [dry-run] already-reacted output", async () => {
    vi.mocked(reactToPost).mockResolvedValue({
      ...MOCK_RESULT,
      alreadyReacted: true,
      currentReaction: "like",
      dryRun: true,
    });

    await handleReactToPost(
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      { dryRun: true },
    );

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("[dry-run]");
    expect(output).toContain('Already reacted to post with "like"');
  });

  it("sets exitCode on error", async () => {
    vi.mocked(reactToPost).mockRejectedValue(
      new Error("connection refused"),
    );

    await handleReactToPost(
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      {},
    );

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("connection refused");
  });
});
