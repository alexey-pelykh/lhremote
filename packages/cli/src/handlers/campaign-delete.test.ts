// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignDelete: vi.fn(),
  };
});

import {
  type CampaignDeleteOutput,
  CampaignExecutionError,
  CampaignNotFoundError,
  InstanceNotRunningError,
  campaignDelete,
} from "@lhremote/core";

import { handleCampaignDelete } from "./campaign-delete.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: CampaignDeleteOutput = {
  success: true as const,
  campaignId: 5,
  action: "archived",
};

describe("handleCampaignDelete", () => {
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

  it("archives campaign and prints confirmation", async () => {
    vi.mocked(campaignDelete).mockResolvedValue(MOCK_RESULT);

    await handleCampaignDelete(5, {});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain("Campaign 5 archived.");
  });

  it("prints JSON with --json", async () => {
    vi.mocked(campaignDelete).mockResolvedValue(MOCK_RESULT);

    await handleCampaignDelete(5, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(5);
    expect(parsed.action).toBe("archived");
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(campaignDelete).mockRejectedValue(new CampaignNotFoundError(999));

    await handleCampaignDelete(999, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 on CampaignExecutionError", async () => {
    vi.mocked(campaignDelete).mockRejectedValue(
      new CampaignExecutionError("cannot delete running campaign"),
    );

    await handleCampaignDelete(5, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Failed to delete campaign: cannot delete running campaign\n",
    );
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    vi.mocked(campaignDelete).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleCampaignDelete(5, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(campaignDelete).mockRejectedValue(new Error("connection error"));

    await handleCampaignDelete(5, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("connection error\n");
  });
});
