// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignExcludeList: vi.fn(),
  };
});

import {
  type CampaignExcludeListOutput,
  ActionNotFoundError,
  CampaignNotFoundError,
  ExcludeListNotFoundError,
  campaignExcludeList,
} from "@lhremote/core";

import { handleCampaignExcludeList } from "./campaign-exclude-list.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: CampaignExcludeListOutput = {
  campaignId: 1,
  level: "campaign",
  count: 2,
  personIds: [100, 200],
};

describe("handleCampaignExcludeList", () => {
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

  it("prints campaign-level exclude list", async () => {
    vi.mocked(campaignExcludeList).mockResolvedValue(MOCK_RESULT);

    await handleCampaignExcludeList(1, {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("Exclude list for campaign 1: 2 person(s)");
    expect(output).toContain("Person IDs: 100, 200");
  });

  it("prints action-level exclude list", async () => {
    vi.mocked(campaignExcludeList).mockResolvedValue({
      ...MOCK_RESULT,
      actionId: 10,
      level: "action",
    });

    await handleCampaignExcludeList(1, { actionId: 10 });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain(
      "Exclude list for action 10 in campaign 1: 2 person(s)",
    );
  });

  it("does not print person IDs when list is empty", async () => {
    vi.mocked(campaignExcludeList).mockResolvedValue({
      ...MOCK_RESULT,
      count: 0,
      personIds: [],
    });

    await handleCampaignExcludeList(1, {});

    const output = getStdout(stdoutSpy);
    expect(output).toContain("0 person(s)");
    expect(output).not.toContain("Person IDs:");
  });

  it("prints JSON with --json", async () => {
    vi.mocked(campaignExcludeList).mockResolvedValue(MOCK_RESULT);

    await handleCampaignExcludeList(1, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.campaignId).toBe(1);
    expect(parsed.level).toBe("campaign");
    expect(parsed.count).toBe(2);
    expect(parsed.personIds).toEqual([100, 200]);
  });

  it("includes actionId in JSON when action-level", async () => {
    vi.mocked(campaignExcludeList).mockResolvedValue({
      ...MOCK_RESULT,
      actionId: 10,
      level: "action",
    });

    await handleCampaignExcludeList(1, { actionId: 10, json: true });

    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.actionId).toBe(10);
    expect(parsed.level).toBe("action");
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(campaignExcludeList).mockRejectedValue(new CampaignNotFoundError(999));

    await handleCampaignExcludeList(999, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when action not found", async () => {
    vi.mocked(campaignExcludeList).mockRejectedValue(new ActionNotFoundError(99, 1));

    await handleCampaignExcludeList(1, { actionId: 99 });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Action 99 not found in campaign 1.\n",
    );
  });

  it("sets exitCode 1 on ExcludeListNotFoundError", async () => {
    vi.mocked(campaignExcludeList).mockRejectedValue(
      new ExcludeListNotFoundError("campaign", 1),
    );

    await handleCampaignExcludeList(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Exclude list not found for campaign 1\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(campaignExcludeList).mockRejectedValue(new Error("timeout"));

    await handleCampaignExcludeList(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
