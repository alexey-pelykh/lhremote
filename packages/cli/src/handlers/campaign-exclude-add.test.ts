// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignExcludeAdd: vi.fn(),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

import {
  type CampaignExcludeAddOutput,
  ActionNotFoundError,
  CampaignNotFoundError,
  ExcludeListNotFoundError,
  campaignExcludeAdd,
} from "@lhremote/core";
import { readFileSync } from "node:fs";

import { handleCampaignExcludeAdd } from "./campaign-exclude-add.js";
import { getStdout } from "./testing/mock-helpers.js";

function mockResult(added: number, alreadyExcluded = 0): CampaignExcludeAddOutput {
  return {
    success: true as const,
    campaignId: 1,
    level: "campaign",
    added,
    alreadyExcluded,
  };
}

describe("handleCampaignExcludeAdd", () => {
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

  it("adds persons to campaign-level exclude list", async () => {
    vi.mocked(campaignExcludeAdd).mockResolvedValue(mockResult(2));

    await handleCampaignExcludeAdd(1, { personIds: "100,200" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain(
      "Added 2 person(s) to exclude list for campaign 1.",
    );
  });

  it("adds persons to action-level exclude list", async () => {
    vi.mocked(campaignExcludeAdd).mockResolvedValue({
      ...mockResult(2),
      actionId: 10,
      level: "action",
    });

    await handleCampaignExcludeAdd(1, { personIds: "100,200", actionId: 10 });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain(
      "Added 2 person(s) to exclude list for action 10 in campaign 1.",
    );
  });

  it("shows already-excluded count", async () => {
    vi.mocked(campaignExcludeAdd).mockResolvedValue(mockResult(1, 1));

    await handleCampaignExcludeAdd(1, { personIds: "100,200" });

    const output = getStdout(stdoutSpy);
    expect(output).toContain("Added 1 person(s)");
    expect(output).toContain("1 person(s) already in exclude list.");
  });

  it("reads from --person-ids-file", async () => {
    vi.mocked(readFileSync).mockReturnValue("100\n200\n300");
    vi.mocked(campaignExcludeAdd).mockResolvedValue(mockResult(3));

    await handleCampaignExcludeAdd(1, { personIdsFile: "ids.txt" });

    expect(process.exitCode).toBeUndefined();
  });

  it("prints JSON with --json", async () => {
    vi.mocked(campaignExcludeAdd).mockResolvedValue(mockResult(2));

    await handleCampaignExcludeAdd(1, { personIds: "100,200", json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(1);
    expect(parsed.level).toBe("campaign");
    expect(parsed.added).toBe(2);
    expect(parsed.alreadyExcluded).toBe(0);
  });

  it("includes actionId in JSON when action-level", async () => {
    vi.mocked(campaignExcludeAdd).mockResolvedValue({
      ...mockResult(1),
      actionId: 10,
      level: "action",
    });

    await handleCampaignExcludeAdd(1, {
      personIds: "100",
      actionId: 10,
      json: true,
    });

    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.actionId).toBe(10);
    expect(parsed.level).toBe("action");
  });

  it("sets exitCode 1 when both person-ids options provided", async () => {
    await handleCampaignExcludeAdd(1, {
      personIds: "100",
      personIdsFile: "ids.txt",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Use only one of --person-ids or --person-ids-file.\n",
    );
  });

  it("sets exitCode 1 when no person-ids option provided", async () => {
    await handleCampaignExcludeAdd(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Either --person-ids or --person-ids-file is required.\n",
    );
  });

  it("sets exitCode 1 when person IDs are empty", async () => {
    vi.mocked(readFileSync).mockReturnValue("");

    await handleCampaignExcludeAdd(1, { personIdsFile: "empty.txt" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("No person IDs provided.\n");
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(campaignExcludeAdd).mockRejectedValue(new CampaignNotFoundError(999));

    await handleCampaignExcludeAdd(999, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when action not found", async () => {
    vi.mocked(campaignExcludeAdd).mockRejectedValue(new ActionNotFoundError(99, 1));

    await handleCampaignExcludeAdd(1, { personIds: "100", actionId: 99 });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Action 99 not found in campaign 1.\n",
    );
  });

  it("sets exitCode 1 on ExcludeListNotFoundError", async () => {
    vi.mocked(campaignExcludeAdd).mockRejectedValue(
      new ExcludeListNotFoundError("campaign", 1),
    );

    await handleCampaignExcludeAdd(1, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Exclude list not found for campaign 1\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(campaignExcludeAdd).mockRejectedValue(new Error("timeout"));

    await handleCampaignExcludeAdd(1, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
