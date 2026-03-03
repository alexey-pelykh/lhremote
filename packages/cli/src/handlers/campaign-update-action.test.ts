// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignUpdateAction: vi.fn(),
  };
});

import {
  type CampaignUpdateActionOutput,
  ActionNotFoundError,
  CampaignNotFoundError,
  campaignUpdateAction,
} from "@lhremote/core";

import { handleCampaignUpdateAction } from "./campaign-update-action.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: CampaignUpdateActionOutput = {
  id: 10,
  campaignId: 1,
  name: "Visit",
  description: null,
  config: {
    id: 100,
    actionType: "VisitAndExtract",
    actionSettings: { extractEmails: true },
    coolDown: 30000,
    maxActionResultsPerIteration: 20,
    isDraft: false,
  },
  versionId: 1,
};

describe("handleCampaignUpdateAction", () => {
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

  it("updates action and prints confirmation", async () => {
    vi.mocked(campaignUpdateAction).mockResolvedValue(MOCK_RESULT);

    await handleCampaignUpdateAction(1, 10, { coolDown: 30000 });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain(
      'Action #10 "Visit" updated in campaign #1.',
    );
  });

  it("prints JSON with --json", async () => {
    vi.mocked(campaignUpdateAction).mockResolvedValue(MOCK_RESULT);

    await handleCampaignUpdateAction(1, 10, { coolDown: 30000, json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.id).toBe(10);
    expect(parsed.config.coolDown).toBe(30000);
  });

  it("passes optional parameters to operation", async () => {
    vi.mocked(campaignUpdateAction).mockResolvedValue(MOCK_RESULT);

    await handleCampaignUpdateAction(1, 10, {
      name: "Updated Visit",
      coolDown: 30000,
      maxResults: 50,
    });

    expect(campaignUpdateAction).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 1,
        actionId: 10,
        name: "Updated Visit",
        coolDown: 30000,
        maxActionResultsPerIteration: 50,
      }),
    );
  });

  it("parses action settings JSON", async () => {
    vi.mocked(campaignUpdateAction).mockResolvedValue(MOCK_RESULT);

    await handleCampaignUpdateAction(1, 10, {
      actionSettings: '{"extractEmails":true}',
    });

    expect(campaignUpdateAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionSettings: { extractEmails: true },
      }),
    );
  });

  it("sets exitCode 1 on invalid action settings JSON", async () => {
    await handleCampaignUpdateAction(1, 10, {
      actionSettings: "bad json",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Invalid JSON in --action-settings.\n",
    );
  });

  it("passes null description when --clear-description is used", async () => {
    vi.mocked(campaignUpdateAction).mockResolvedValue(MOCK_RESULT);

    await handleCampaignUpdateAction(1, 10, { clearDescription: true });

    expect(campaignUpdateAction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: null,
      }),
    );
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(campaignUpdateAction).mockRejectedValue(new CampaignNotFoundError(999));

    await handleCampaignUpdateAction(999, 10, { coolDown: 30000 });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when action not found", async () => {
    vi.mocked(campaignUpdateAction).mockRejectedValue(new ActionNotFoundError(99, 1));

    await handleCampaignUpdateAction(1, 99, { coolDown: 30000 });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Action 99 not found in campaign 1.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(campaignUpdateAction).mockRejectedValue(new Error("timeout"));

    await handleCampaignUpdateAction(1, 10, { coolDown: 30000 });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
