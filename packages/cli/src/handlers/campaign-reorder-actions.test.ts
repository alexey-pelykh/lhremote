// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignReorderActions: vi.fn(),
  };
});

import {
  type CampaignReorderActionsOutput,
  ActionNotFoundError,
  CampaignExecutionError,
  CampaignNotFoundError,
  InstanceNotRunningError,
  campaignReorderActions,
} from "@lhremote/core";

import { handleCampaignReorderActions } from "./campaign-reorder-actions.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: CampaignReorderActionsOutput = {
  success: true as const,
  campaignId: 1,
  actions: [
    {
      id: 2,
      campaignId: 1,
      name: "Send Message",
      description: null,
      config: {
        id: 101,
        actionType: "MessageToPerson",
        actionSettings: {},
        coolDown: 60000,
        maxActionResultsPerIteration: 10,
        isDraft: false,
      },
      versionId: 1,
    },
    {
      id: 1,
      campaignId: 1,
      name: "Visit Profile",
      description: null,
      config: {
        id: 100,
        actionType: "VisitAndExtract",
        actionSettings: {},
        coolDown: 60000,
        maxActionResultsPerIteration: 10,
        isDraft: false,
      },
      versionId: 1,
    },
  ],
};

describe("handleCampaignReorderActions", () => {
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

  it("reorders actions and prints confirmation", async () => {
    vi.mocked(campaignReorderActions).mockResolvedValue(MOCK_RESULT);

    await handleCampaignReorderActions(1, { actionIds: "2,1" });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("Actions reordered in campaign 1.");
    expect(output).toContain('#2 "Send Message" (MessageToPerson)');
    expect(output).toContain('#1 "Visit Profile" (VisitAndExtract)');
  });

  it("prints JSON with --json", async () => {
    vi.mocked(campaignReorderActions).mockResolvedValue(MOCK_RESULT);

    await handleCampaignReorderActions(1, { actionIds: "2,1", json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(1);
    expect(parsed.actions).toHaveLength(2);
  });

  it("sets exitCode 1 on invalid action ID", async () => {
    await handleCampaignReorderActions(1, { actionIds: "1,abc" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid action ID: "abc"'),
    );
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(campaignReorderActions).mockRejectedValue(new CampaignNotFoundError(999));

    await handleCampaignReorderActions(999, { actionIds: "1,2" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when action not found", async () => {
    vi.mocked(campaignReorderActions).mockRejectedValue(new ActionNotFoundError(99, 1));

    await handleCampaignReorderActions(1, { actionIds: "99,1" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "One or more action IDs not found in campaign 1.\n",
    );
  });

  it("sets exitCode 1 on CampaignExecutionError", async () => {
    vi.mocked(campaignReorderActions).mockRejectedValue(
      new CampaignExecutionError("count mismatch"),
    );

    await handleCampaignReorderActions(1, { actionIds: "1" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Failed to reorder actions: count mismatch\n",
    );
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    vi.mocked(campaignReorderActions).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleCampaignReorderActions(1, { actionIds: "1,2" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(campaignReorderActions).mockRejectedValue(new Error("timeout"));

    await handleCampaignReorderActions(1, { actionIds: "1,2" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
