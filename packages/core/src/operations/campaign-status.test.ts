// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withInstanceDatabase: vi.fn(),
}));

vi.mock("../services/campaign.js", () => ({
  CampaignService: vi.fn(),
}));

import type { InstanceDatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CampaignService } from "../services/campaign.js";
import { campaignStatus } from "./campaign-status.js";

const MOCK_STATUS = {
  campaignState: "active" as const,
  isPaused: false,
  runnerState: "campaigns" as const,
  actionCounts: [
    { actionId: 1, queued: 10, processed: 5, successful: 4, failed: 1 },
  ],
};

const MOCK_RESULTS = {
  campaignId: 42,
  results: [
    { id: 1, actionVersionId: 1, personId: 100, result: 3, platform: "linkedin", createdAt: "2026-01-01T00:00:00Z" },
    { id: 2, actionVersionId: 1, personId: 101, result: 3, platform: "linkedin", createdAt: "2026-01-01T00:01:00Z" },
    { id: 3, actionVersionId: 1, personId: 102, result: 3, platform: "linkedin", createdAt: "2026-01-01T00:02:00Z" },
  ],
  actionCounts: MOCK_STATUS.actionCounts,
};

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withInstanceDatabase).mockImplementation(
    async (_cdpPort, _accountId, callback) =>
      callback({
        accountId: 1,
        instance: {},
        db: {},
      } as unknown as InstanceDatabaseContext),
  );

  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      getStatus: vi.fn().mockResolvedValue(MOCK_STATUS),
      getResults: vi.fn().mockResolvedValue(MOCK_RESULTS),
    } as unknown as CampaignService;
  });
}

describe("campaignStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns campaign status with campaignId", async () => {
    setupMocks();

    const result = await campaignStatus({
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(result.campaignId).toBe(42);
    expect(result.campaignState).toBe("active");
    expect(result.isPaused).toBe(false);
    expect(result.runnerState).toBe("campaigns");
    expect(result.actionCounts).toHaveLength(1);
    expect(result.results).toBeUndefined();
  });

  it("includes results when includeResults is true", async () => {
    setupMocks();

    const result = await campaignStatus({
      campaignId: 42,
      cdpPort: 9222,
      includeResults: true,
    });

    expect(result.results).toHaveLength(3);
  });

  it("limits results to specified limit", async () => {
    setupMocks();

    const result = await campaignStatus({
      campaignId: 42,
      cdpPort: 9222,
      includeResults: true,
      limit: 1,
    });

    expect(result.results).toHaveLength(1);
  });

  it("defaults limit to 20", async () => {
    setupMocks();

    const result = await campaignStatus({
      campaignId: 42,
      cdpPort: 9222,
      includeResults: true,
    });

    // All 3 results returned since 3 < default limit of 20
    expect(result.results).toHaveLength(3);
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await campaignStatus({
      campaignId: 42,
      cdpPort: 1234,
      cdpHost: "192.168.1.1",
      allowRemote: true,
    });

    expect(resolveAccount).toHaveBeenCalledWith(1234, {
      host: "192.168.1.1",
      allowRemote: true,
    });
  });

  it("omits undefined connection options", async () => {
    setupMocks();

    await campaignStatus({
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      campaignStatus({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withInstanceDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new Error("instance not running"),
    );

    await expect(
      campaignStatus({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("instance not running");
  });

  it("propagates CampaignService errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: {},
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        getStatus: vi.fn().mockRejectedValue(new Error("campaign not found")),
      } as unknown as CampaignService;
    });

    await expect(
      campaignStatus({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("campaign not found");
  });
});
