// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignUpdate: vi.fn(),
  };
});

import {
  type CampaignUpdateOutput,
  CampaignNotFoundError,
  campaignUpdate,
} from "@lhremote/core";

import { handleCampaignUpdate } from "./campaign-update.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: CampaignUpdateOutput = {
  id: 1,
  name: "Updated Name",
  description: null,
  state: "active",
  liAccountId: 1,
  isPaused: false,
  isArchived: false,
  isValid: true,
  createdAt: "2025-01-01T00:00:00Z",
};

describe("handleCampaignUpdate", () => {
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

  it("updates campaign name and prints confirmation", async () => {
    vi.mocked(campaignUpdate).mockResolvedValue(MOCK_RESULT);

    await handleCampaignUpdate(1, { name: "Updated Name" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain('Campaign updated: #1 "Updated Name"');
  });

  it("prints JSON with --json", async () => {
    vi.mocked(campaignUpdate).mockResolvedValue(MOCK_RESULT);

    await handleCampaignUpdate(1, { name: "Updated Name", json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.id).toBe(1);
    expect(parsed.name).toBe("Updated Name");
  });

  it("passes name update to operation", async () => {
    vi.mocked(campaignUpdate).mockResolvedValue(MOCK_RESULT);

    await handleCampaignUpdate(1, { name: "New Name" });

    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 1,
        updates: { name: "New Name" },
      }),
    );
  });

  it("passes description update to operation", async () => {
    vi.mocked(campaignUpdate).mockResolvedValue(MOCK_RESULT);

    await handleCampaignUpdate(1, { description: "New desc" });

    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 1,
        updates: { description: "New desc" },
      }),
    );
  });

  it("passes null description when --clear-description", async () => {
    vi.mocked(campaignUpdate).mockResolvedValue(MOCK_RESULT);

    await handleCampaignUpdate(1, { clearDescription: true });

    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 1,
        updates: { description: null },
      }),
    );
  });

  it("sets exitCode 1 when no update options provided", async () => {
    await handleCampaignUpdate(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "At least one of --name, --description, or --clear-description is required.\n",
    );
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(campaignUpdate).mockRejectedValue(new CampaignNotFoundError(999));

    await handleCampaignUpdate(999, { name: "x" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(campaignUpdate).mockRejectedValue(new Error("timeout"));

    await handleCampaignUpdate(1, { name: "x" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
