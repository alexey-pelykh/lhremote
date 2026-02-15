// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignAddAction: vi.fn(),
  };
});

import {
  type CampaignAddActionOutput,
  CampaignNotFoundError,
  campaignAddAction,
} from "@lhremote/core";

import { handleCampaignAddAction } from "./campaign-add-action.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: CampaignAddActionOutput = {
  id: 10,
  campaignId: 1,
  name: "Visit",
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
};

describe("handleCampaignAddAction", () => {
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

  it("adds action and prints confirmation", async () => {
    vi.mocked(campaignAddAction).mockResolvedValue(MOCK_RESULT);

    await handleCampaignAddAction(1, {
      name: "Visit",
      actionType: "VisitAndExtract",
    });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain(
      'Action added: #10 "Visit" (VisitAndExtract) to campaign #1',
    );
  });

  it("prints JSON with --json", async () => {
    vi.mocked(campaignAddAction).mockResolvedValue(MOCK_RESULT);

    await handleCampaignAddAction(1, {
      name: "Visit",
      actionType: "VisitAndExtract",
      json: true,
    });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.id).toBe(10);
    expect(parsed.name).toBe("Visit");
  });

  it("passes optional parameters to operation", async () => {
    vi.mocked(campaignAddAction).mockResolvedValue(MOCK_RESULT);

    await handleCampaignAddAction(1, {
      name: "Visit",
      actionType: "VisitAndExtract",
      description: "Visit and extract data",
      coolDown: 30,
      maxResults: 100,
    });

    expect(campaignAddAction).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 1,
        name: "Visit",
        actionType: "VisitAndExtract",
        description: "Visit and extract data",
        coolDown: 30,
        maxActionResultsPerIteration: 100,
      }),
    );
  });

  it("parses action settings JSON", async () => {
    vi.mocked(campaignAddAction).mockResolvedValue(MOCK_RESULT);

    await handleCampaignAddAction(1, {
      name: "Visit",
      actionType: "VisitAndExtract",
      actionSettings: '{"extractEmails":true}',
    });

    expect(campaignAddAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionSettings: { extractEmails: true },
      }),
    );
  });

  it("sets exitCode 1 on invalid action settings JSON", async () => {
    await handleCampaignAddAction(1, {
      name: "Visit",
      actionType: "VisitAndExtract",
      actionSettings: "bad json",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Invalid JSON in --action-settings.\n",
    );
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(campaignAddAction).mockRejectedValue(new CampaignNotFoundError(999));

    await handleCampaignAddAction(999, {
      name: "Visit",
      actionType: "VisitAndExtract",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(campaignAddAction).mockRejectedValue(new Error("timeout"));

    await handleCampaignAddAction(1, {
      name: "Visit",
      actionType: "VisitAndExtract",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
