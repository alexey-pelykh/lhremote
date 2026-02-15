// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignStop: vi.fn(),
  };
});

import {
  type CampaignStopOutput,
  CampaignExecutionError,
  CampaignNotFoundError,
  InstanceNotRunningError,
  campaignStop,
} from "@lhremote/core";

import { handleCampaignStop } from "./campaign-stop.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: CampaignStopOutput = {
  success: true as const,
  campaignId: 5,
  message: "Campaign paused",
};

describe("handleCampaignStop", () => {
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

  it("pauses campaign and prints confirmation", async () => {
    vi.mocked(campaignStop).mockResolvedValue(MOCK_RESULT);

    await handleCampaignStop(5, {});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain("Campaign 5 paused.");
  });

  it("prints JSON with --json", async () => {
    vi.mocked(campaignStop).mockResolvedValue(MOCK_RESULT);

    await handleCampaignStop(5, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(5);
    expect(parsed.message).toBe("Campaign paused");
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(campaignStop).mockRejectedValue(new CampaignNotFoundError(999));

    await handleCampaignStop(999, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 on CampaignExecutionError", async () => {
    vi.mocked(campaignStop).mockRejectedValue(
      new CampaignExecutionError("already stopped"),
    );

    await handleCampaignStop(5, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Failed to stop campaign: already stopped\n",
    );
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    vi.mocked(campaignStop).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleCampaignStop(5, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(campaignStop).mockRejectedValue(new Error("timeout"));

    await handleCampaignStop(5, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
