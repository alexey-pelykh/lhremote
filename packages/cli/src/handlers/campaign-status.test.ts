// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignStatus: vi.fn(),
  };
});

import {
  type CampaignStatusOutput,
  CampaignExecutionError,
  CampaignNotFoundError,
  InstanceNotRunningError,
  campaignStatus,
} from "@lhremote/core";

import { handleCampaignStatus } from "./campaign-status.js";

const MOCK_STATUS_RESULT: CampaignStatusOutput = {
  campaignId: 1,
  campaignState: "active",
  isPaused: false,
  runnerState: "campaigns",
  actionCounts: [
    { actionId: 1, queued: 10, processed: 5, successful: 4, failed: 1 },
  ],
};

const MOCK_RESULTS: CampaignStatusOutput["results"] = [
  { id: 1, personId: 100, result: 3, actionVersionId: 1, platform: "linkedin", createdAt: "2026-01-01T00:00:00Z" },
  { id: 2, personId: 101, result: 0, actionVersionId: 1, platform: "linkedin", createdAt: "2026-01-01T00:01:00Z" },
];

describe("handleCampaignStatus", () => {
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

  function getStdout(): string {
    return stdoutSpy.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join("");
  }

  it("prints human-readable status", async () => {
    vi.mocked(campaignStatus).mockResolvedValue(MOCK_STATUS_RESULT);

    await handleCampaignStatus(1, {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("Campaign #1 Status");
    expect(output).toContain("State: active");
    expect(output).toContain("Paused: no");
    expect(output).toContain("Runner: campaigns");
    expect(output).toContain("Action #1: 10 queued, 5 processed, 4 successful, 1 failed");
  });

  it("prints JSON with --json", async () => {
    vi.mocked(campaignStatus).mockResolvedValue(MOCK_STATUS_RESULT);

    await handleCampaignStatus(1, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.campaignId).toBe(1);
    expect(parsed.campaignState).toBe("active");
    expect(parsed.actionCounts).toHaveLength(1);
  });

  it("includes results with --include-results", async () => {
    vi.mocked(campaignStatus).mockResolvedValue({
      ...MOCK_STATUS_RESULT,
      results: MOCK_RESULTS,
    });

    await handleCampaignStatus(1, { includeResults: true });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("Results (2):");
    expect(output).toContain("Person 100: result=3");
    expect(output).toContain("Person 101: result=0");
  });

  it("includes results in JSON with --include-results --json", async () => {
    vi.mocked(campaignStatus).mockResolvedValue({
      ...MOCK_STATUS_RESULT,
      results: MOCK_RESULTS,
    });

    await handleCampaignStatus(1, { includeResults: true, json: true });

    const parsed = JSON.parse(getStdout());
    expect(parsed.results).toHaveLength(2);
  });

  it("prints 'No results yet' when results empty", async () => {
    vi.mocked(campaignStatus).mockResolvedValue({
      ...MOCK_STATUS_RESULT,
      results: [],
    });

    await handleCampaignStatus(1, { includeResults: true });

    expect(getStdout()).toContain("No results yet.");
  });

  it("omits action counts section when empty", async () => {
    vi.mocked(campaignStatus).mockResolvedValue({
      ...MOCK_STATUS_RESULT,
      actionCounts: [],
    });

    await handleCampaignStatus(1, {});

    expect(getStdout()).not.toContain("Action Counts:");
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(campaignStatus).mockRejectedValue(new CampaignNotFoundError(999));

    await handleCampaignStatus(999, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 on CampaignExecutionError", async () => {
    vi.mocked(campaignStatus).mockRejectedValue(
      new CampaignExecutionError("status unavailable"),
    );

    await handleCampaignStatus(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Failed to get campaign status: status unavailable\n",
    );
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    vi.mocked(campaignStatus).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleCampaignStatus(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(campaignStatus).mockRejectedValue(new Error("timeout"));

    await handleCampaignStatus(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
