// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignRemovePeople: vi.fn(),
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
  type CampaignRemovePeopleOutput,
  CampaignExecutionError,
  CampaignNotFoundError,
  InstanceNotRunningError,
  campaignRemovePeople,
} from "@lhremote/core";
import { readFileSync } from "node:fs";

import { handleCampaignRemovePeople } from "./campaign-remove-people.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: CampaignRemovePeopleOutput = {
  success: true as const,
  campaignId: 1,
  actionId: 10,
  removed: 2,
};

describe("handleCampaignRemovePeople", () => {
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

  it("removes people from campaign and prints result", async () => {
    vi.mocked(campaignRemovePeople).mockResolvedValue(MOCK_RESULT);

    await handleCampaignRemovePeople(1, { personIds: "100,200" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain(
      "Removed 2 person(s) from campaign 1 action 10.",
    );
  });

  it("reads from --person-ids-file", async () => {
    vi.mocked(readFileSync).mockReturnValue("100\n200\n300");
    vi.mocked(campaignRemovePeople).mockResolvedValue({
      ...MOCK_RESULT,
      removed: 3,
    });

    await handleCampaignRemovePeople(1, { personIdsFile: "ids.txt" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain("Removed 3 person(s)");
  });

  it("prints JSON with --json", async () => {
    vi.mocked(campaignRemovePeople).mockResolvedValue(MOCK_RESULT);

    await handleCampaignRemovePeople(1, { personIds: "100,200", json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(1);
    expect(parsed.actionId).toBe(10);
    expect(parsed.removed).toBe(2);
  });

  it("sets exitCode 1 when both person-ids options provided", async () => {
    await handleCampaignRemovePeople(1, {
      personIds: "100",
      personIdsFile: "ids.txt",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Use only one of --person-ids or --person-ids-file.\n",
    );
  });

  it("sets exitCode 1 when no person-ids option provided", async () => {
    await handleCampaignRemovePeople(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Either --person-ids or --person-ids-file is required.\n",
    );
  });

  it("sets exitCode 1 when person IDs are empty", async () => {
    vi.mocked(readFileSync).mockReturnValue("");

    await handleCampaignRemovePeople(1, { personIdsFile: "empty.txt" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("No person IDs provided.\n");
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(campaignRemovePeople).mockRejectedValue(new CampaignNotFoundError(999));

    await handleCampaignRemovePeople(999, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 on CampaignExecutionError", async () => {
    vi.mocked(campaignRemovePeople).mockRejectedValue(
      new CampaignExecutionError("remove failed"),
    );

    await handleCampaignRemovePeople(1, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Failed to remove people: remove failed\n",
    );
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    vi.mocked(campaignRemovePeople).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleCampaignRemovePeople(1, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(campaignRemovePeople).mockRejectedValue(new Error("timeout"));

    await handleCampaignRemovePeople(1, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
