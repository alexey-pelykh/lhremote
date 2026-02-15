// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignRemoveAction: vi.fn(),
  };
});

import {
  type CampaignRemoveActionOutput,
  ActionNotFoundError,
  CampaignExecutionError,
  CampaignNotFoundError,
  InstanceNotRunningError,
  campaignRemoveAction,
} from "@lhremote/core";

import { handleCampaignRemoveAction } from "./campaign-remove-action.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: CampaignRemoveActionOutput = {
  success: true as const,
  campaignId: 1,
  removedActionId: 10,
};

describe("handleCampaignRemoveAction", () => {
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

  it("removes action and prints confirmation", async () => {
    vi.mocked(campaignRemoveAction).mockResolvedValue(MOCK_RESULT);

    await handleCampaignRemoveAction(1, 10, {});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain("Action 10 removed from campaign 1.");
  });

  it("prints JSON with --json", async () => {
    vi.mocked(campaignRemoveAction).mockResolvedValue(MOCK_RESULT);

    await handleCampaignRemoveAction(1, 10, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(1);
    expect(parsed.removedActionId).toBe(10);
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(campaignRemoveAction).mockRejectedValue(new CampaignNotFoundError(999));

    await handleCampaignRemoveAction(999, 10, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when action not found", async () => {
    vi.mocked(campaignRemoveAction).mockRejectedValue(new ActionNotFoundError(99, 1));

    await handleCampaignRemoveAction(1, 99, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Action 99 not found in campaign 1.\n",
    );
  });

  it("sets exitCode 1 on CampaignExecutionError", async () => {
    vi.mocked(campaignRemoveAction).mockRejectedValue(
      new CampaignExecutionError("in use"),
    );

    await handleCampaignRemoveAction(1, 10, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Failed to remove action: in use\n");
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    vi.mocked(campaignRemoveAction).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleCampaignRemoveAction(1, 10, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(campaignRemoveAction).mockRejectedValue(new Error("timeout"));

    await handleCampaignRemoveAction(1, 10, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
