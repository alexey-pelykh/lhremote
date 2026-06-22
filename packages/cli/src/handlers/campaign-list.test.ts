// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@insoftex/lhremote-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@insoftex/lhremote-core")>();
  return {
    ...actual,
    campaignList: vi.fn(),
  };
});

import { type CampaignListOutput, type CampaignSummary, campaignList, InstanceNotRunningError } from "@insoftex/lhremote-core";

import { handleCampaignList } from "./campaign-list.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_CAMPAIGNS: CampaignSummary[] = [
  {
    id: 1,
    name: "Outreach Q1",
    state: "active",
    liAccountId: 42,
    actionCount: 3,
    createdAt: "2025-01-01T00:00:00Z",
    description: "Q1 outreach campaign",
  },
  {
    id: 2,
    name: "Follow-Up",
    state: "paused",
    liAccountId: 42,
    actionCount: 1,
    createdAt: "2025-01-02T00:00:00Z",
    description: null,
  },
];

const MOCK_RESULT: CampaignListOutput = {
  campaigns: MOCK_CAMPAIGNS,
  total: MOCK_CAMPAIGNS.length,
};

describe("handleCampaignList", () => {
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

  it("prints JSON with --json", async () => {
    vi.mocked(campaignList).mockResolvedValue(MOCK_RESULT);

    await handleCampaignList({ json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.campaigns).toHaveLength(2);
    expect(parsed.total).toBe(2);
  });

  it("prints human-readable output", async () => {
    vi.mocked(campaignList).mockResolvedValue(MOCK_RESULT);

    await handleCampaignList({});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("Campaigns (2 total):");
    expect(output).toContain("#1  Outreach Q1");
    expect(output).toContain("[active]");
    expect(output).toContain("3 actions");
    expect(output).toContain("Q1 outreach campaign");
    expect(output).toContain("#2  Follow-Up");
    expect(output).toContain("[paused]");
  });

  it("prints 'No campaigns found' when empty", async () => {
    vi.mocked(campaignList).mockResolvedValue({ campaigns: [], total: 0 });

    await handleCampaignList({});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain("No campaigns found.");
  });

  it("passes includeArchived to campaignList", async () => {
    vi.mocked(campaignList).mockResolvedValue({ campaigns: [], total: 0 });

    await handleCampaignList({ includeArchived: true });

    expect(campaignList).toHaveBeenCalledWith(
      expect.objectContaining({ includeArchived: true }),
    );
  });

  it("forwards accountId to campaignList", async () => {
    vi.mocked(campaignList).mockResolvedValue(MOCK_RESULT);

    await handleCampaignList({ accountId: 7 });

    expect(campaignList).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 7 }),
    );
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    vi.mocked(campaignList).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleCampaignList({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });

  it("sets exitCode 1 on general error", async () => {
    vi.mocked(campaignList).mockRejectedValue(new Error("database locked"));

    await handleCampaignList({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("database locked"),
    );
  });
});
