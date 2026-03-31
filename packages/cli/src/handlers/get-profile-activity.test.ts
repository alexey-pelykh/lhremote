// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, getProfileActivity: vi.fn() };
});

import {
  getProfileActivity,
  type GetProfileActivityOutput,
} from "@lhremote/core";
import { handleGetProfileActivity } from "./get-profile-activity.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: GetProfileActivityOutput = {
  profilePublicId: "alice",
  posts: [
    {
      url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      authorName: "Alice Smith",
      authorHeadline: "Engineer at Acme",
      authorProfileUrl: "https://www.linkedin.com/in/alice/",
      authorPublicId: "alice",
      text: "Hello world",
      mediaType: null,
      reactionCount: 10,
      commentCount: 3,
      shareCount: 1,
      timestamp: 1700000000000,
      hashtags: [],
    },
  ],
  nextCursor: "cursor-abc",
};

describe("handleGetProfileActivity", () => {
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
    vi.mocked(getProfileActivity).mockResolvedValue(MOCK_RESULT);

    await handleGetProfileActivity("alice", { json: true });

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.profilePublicId).toBe("alice");
    expect(output.posts).toHaveLength(1);
    expect(output.nextCursor).toBe("cursor-abc");
  });

  it("prints human-readable output with post details", async () => {
    vi.mocked(getProfileActivity).mockResolvedValue(MOCK_RESULT);

    await handleGetProfileActivity("alice", {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("Profile: alice");
    expect(output).toContain(
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
    );
    expect(output).toContain("Alice Smith");
    expect(output).toContain("Published:");
    expect(output).toContain("Hello world");
    expect(output).toContain("Reactions: 10");
    expect(output).toContain("Comments: 3");
    expect(output).toContain("Shares: 1");
  });

  it("truncates long text at 120 chars", async () => {
    const longText = "A".repeat(150);
    vi.mocked(getProfileActivity).mockResolvedValue({
      profilePublicId: "alice",
      posts: [
        {
          url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
          authorName: "Alice Smith",
          authorHeadline: null,
          authorProfileUrl: null,
          authorPublicId: null,
          text: longText,
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

    await handleGetProfileActivity("alice", {});

    const output = getStdout(stdoutSpy);
    expect(output).toContain("A".repeat(120) + "...");
    expect(output).not.toContain("A".repeat(150));
  });

  it("prints empty message when no posts", async () => {
    vi.mocked(getProfileActivity).mockResolvedValue({
      ...MOCK_RESULT,
      posts: [],
      nextCursor: null,
    });

    await handleGetProfileActivity("alice", {});

    const output = getStdout(stdoutSpy);
    expect(output).toContain("(no posts found)");
  });

  it("shows next cursor when present", async () => {
    vi.mocked(getProfileActivity).mockResolvedValue(MOCK_RESULT);

    await handleGetProfileActivity("alice", {});

    const output = getStdout(stdoutSpy);
    expect(output).toContain("Next cursor: cursor-abc");
  });

  it("omits next cursor when absent", async () => {
    vi.mocked(getProfileActivity).mockResolvedValue({
      ...MOCK_RESULT,
      nextCursor: null,
    });

    await handleGetProfileActivity("alice", {});

    const output = getStdout(stdoutSpy);
    expect(output).not.toContain("Next cursor:");
  });

  it("sets exitCode on error", async () => {
    vi.mocked(getProfileActivity).mockRejectedValue(
      new Error("connection refused"),
    );

    await handleGetProfileActivity("alice", {});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("connection refused");
  });
});
