// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignErase: vi.fn(),
  };
});

import {
  type CampaignEraseOutput,
  CampaignExecutionError,
  CampaignNotFoundError,
  InstanceNotRunningError,
  campaignErase,
} from "@lhremote/core";

import { handleCampaignErase } from "./campaign-erase.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: CampaignEraseOutput = {
  success: true as const,
  campaignId: 5,
};

describe("handleCampaignErase", () => {
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

  it("erases campaign and prints confirmation", async () => {
    vi.mocked(campaignErase).mockResolvedValue(MOCK_RESULT);

    await handleCampaignErase(5, {});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain("Campaign 5 erased.");
  });

  it("prints JSON with --json", async () => {
    vi.mocked(campaignErase).mockResolvedValue(MOCK_RESULT);

    await handleCampaignErase(5, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(5);
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(campaignErase).mockRejectedValue(new CampaignNotFoundError(999));

    await handleCampaignErase(999, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 on CampaignExecutionError", async () => {
    vi.mocked(campaignErase).mockRejectedValue(
      new CampaignExecutionError("cannot erase running campaign"),
    );

    await handleCampaignErase(5, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Failed to erase campaign: cannot erase running campaign\n",
    );
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    vi.mocked(campaignErase).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleCampaignErase(5, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(campaignErase).mockRejectedValue(new Error("connection error"));

    await handleCampaignErase(5, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("connection error\n");
  });
});
