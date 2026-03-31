// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, getPostStats: vi.fn() };
});

import { getPostStats, type GetPostStatsOutput } from "@lhremote/core";
import { handleGetPostStats } from "./get-post-stats.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: GetPostStatsOutput = {
  stats: {
    postUrn: "urn:li:activity:7123456789012345678",
    reactionCount: 25,
    reactionsByType: [
      { type: "LIKE", count: 15 },
      { type: "PRAISE", count: 5 },
    ],
    commentCount: 10,
    shareCount: 3,
  },
};

describe("handleGetPostStats", () => {
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
    vi.mocked(getPostStats).mockResolvedValue(MOCK_RESULT);

    await handleGetPostStats(
      "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      { json: true },
    );

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.stats.postUrn).toBe("urn:li:activity:7123456789012345678");
    expect(output.stats.reactionCount).toBe(25);
    expect(output.stats.reactionsByType).toHaveLength(2);
  });

  it("prints human-readable output with stats", async () => {
    vi.mocked(getPostStats).mockResolvedValue(MOCK_RESULT);

    await handleGetPostStats(
      "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      {},
    );

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("urn:li:activity:7123456789012345678");
    expect(output).toContain("Reactions: 25");
    expect(output).toContain("LIKE: 15");
    expect(output).toContain("PRAISE: 5");
    expect(output).toContain("Comments:  10");
    expect(output).toContain("Shares:    3");
  });

  it("handles empty reactionsByType", async () => {
    vi.mocked(getPostStats).mockResolvedValue({
      stats: {
        ...MOCK_RESULT.stats,
        reactionsByType: [],
      },
    });

    await handleGetPostStats(
      "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      {},
    );

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("Reactions: 25");
    expect(output).not.toContain("LIKE:");
    expect(output).not.toContain("PRAISE:");
  });

  it("sets exitCode on error", async () => {
    vi.mocked(getPostStats).mockRejectedValue(
      new Error("connection refused"),
    );

    await handleGetPostStats(
      "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      {},
    );

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("connection refused");
  });
});
