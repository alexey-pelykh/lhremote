// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignGet: vi.fn(),
  };
});

import {
  type CampaignGetOutput,
  CampaignNotFoundError,
  campaignGet,
} from "@lhremote/core";

import { handleCampaignGet } from "./campaign-get.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: CampaignGetOutput = {
  id: 1,
  name: "Outreach Q1",
  state: "active",
  isPaused: false,
  isArchived: false,
  isValid: true,
  description: "Q1 outreach campaign",
  createdAt: "2025-01-01T00:00:00Z",
  liAccountId: 42,
  actions: [
    {
      id: 10,
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
    {
      id: 11,
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
  ],
};

describe("handleCampaignGet", () => {
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
    vi.mocked(campaignGet).mockResolvedValue(MOCK_RESULT);

    await handleCampaignGet(1, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.id).toBe(1);
    expect(parsed.name).toBe("Outreach Q1");
    expect(parsed.actions).toHaveLength(2);
  });

  it("prints human-readable output", async () => {
    vi.mocked(campaignGet).mockResolvedValue(MOCK_RESULT);

    await handleCampaignGet(1, {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("Campaign #1: Outreach Q1");
    expect(output).toContain("State: active");
    expect(output).toContain("Paused: no");
    expect(output).toContain("Archived: no");
    expect(output).toContain("Description: Q1 outreach campaign");
    expect(output).toContain("Actions (2):");
    expect(output).toContain("#10  Visit Profile [VisitAndExtract]");
    expect(output).toContain("#11  Send Message [MessageToPerson]");
  });

  it("omits description when absent", async () => {
    vi.mocked(campaignGet).mockResolvedValue({
      ...MOCK_RESULT,
      description: null as unknown as string,
    });

    await handleCampaignGet(1, {});

    const output = getStdout(stdoutSpy);
    expect(output).not.toContain("Description:");
  });

  it("omits actions section when empty", async () => {
    vi.mocked(campaignGet).mockResolvedValue({
      ...MOCK_RESULT,
      actions: [],
    });

    await handleCampaignGet(1, {});

    const output = getStdout(stdoutSpy);
    expect(output).not.toContain("Actions");
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(campaignGet).mockRejectedValue(new CampaignNotFoundError(999));

    await handleCampaignGet(999, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(campaignGet).mockRejectedValue(
      new Error("No accounts found."),
    );

    await handleCampaignGet(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("No accounts found.\n");
  });

  it("sets exitCode 1 on unexpected error", async () => {
    vi.mocked(campaignGet).mockRejectedValue(new Error("disk failure"));

    await handleCampaignGet(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("disk failure\n");
  });
});
