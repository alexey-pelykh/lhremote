// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    scrapeMessagingHistory: vi.fn(),
  };
});

import {
  type ScrapeMessagingHistoryOutput,
  InstanceNotRunningError,
  scrapeMessagingHistory,
} from "@lhremote/core";

import { handleScrapeMessagingHistory } from "./scrape-messaging-history.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const MOCK_STATS = {
  totalChats: 42,
  totalMessages: 256,
  earliestMessage: "2024-06-01T10:00:00Z",
  latestMessage: "2025-01-15T14:00:00Z",
};

const MOCK_RESULT: ScrapeMessagingHistoryOutput = {
  success: true as const,
  actionType: "ScrapeMessagingHistory",
  stats: MOCK_STATS,
};

describe("handleScrapeMessagingHistory", () => {
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
    vi.mocked(scrapeMessagingHistory).mockResolvedValue(MOCK_RESULT);

    await handleScrapeMessagingHistory({ json: true });

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.success).toBe(true);
    expect(output.actionType).toBe("ScrapeMessagingHistory");
    expect(output.stats).toEqual(MOCK_STATS);
  });

  it("prints human-readable output by default", async () => {
    vi.mocked(scrapeMessagingHistory).mockResolvedValue(MOCK_RESULT);

    await handleScrapeMessagingHistory({});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("42 conversations");
    expect(output).toContain("256 messages");
    expect(output).toContain("2024-06-01");
    expect(output).toContain("2025-01-15");
  });

  it("prints progress to stderr", async () => {
    vi.mocked(scrapeMessagingHistory).mockResolvedValue(MOCK_RESULT);

    await handleScrapeMessagingHistory({});

    const stderr = getStderr(stderrSpy);
    expect(stderr).toContain("Scraping messaging history");
    expect(stderr).toContain("Done.");
  });

  it("omits date range when no messages", async () => {
    vi.mocked(scrapeMessagingHistory).mockResolvedValue({
      success: true as const,
      actionType: "ScrapeMessagingHistory",
      stats: {
        totalChats: 0,
        totalMessages: 0,
        earliestMessage: null as unknown as string,
        latestMessage: null as unknown as string,
      },
    });

    await handleScrapeMessagingHistory({});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("0 conversations");
    expect(output).not.toContain("Date range");
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(scrapeMessagingHistory).mockRejectedValue(
      new Error("No accounts found."),
    );

    await handleScrapeMessagingHistory({});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("No accounts found.");
  });

  it("sets exitCode 1 when instance not running", async () => {
    vi.mocked(scrapeMessagingHistory).mockRejectedValue(
      new InstanceNotRunningError(
        "No LinkedHelper instance is running. Use start-instance first.",
      ),
    );

    await handleScrapeMessagingHistory({});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("No LinkedHelper instance is running.");
  });

  it("sets exitCode 1 on unexpected error", async () => {
    vi.mocked(scrapeMessagingHistory).mockRejectedValue(
      new Error("connection reset"),
    );

    await handleScrapeMessagingHistory({});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("connection reset");
  });
});
