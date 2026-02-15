// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withDatabase: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  CampaignStatisticsRepository: vi.fn(),
}));

import type { DatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignStatisticsRepository } from "../db/index.js";
import { campaignStatistics } from "./campaign-statistics.js";

const MOCK_STATISTICS = {
  campaignId: 42,
  actions: [],
  totals: {
    successful: 70,
    replied: 5,
    failed: 10,
    skipped: 3,
    total: 88,
    successRate: 79.5,
  },
};

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(CampaignStatisticsRepository).mockImplementation(function () {
    return {
      getStatistics: vi.fn().mockReturnValue(MOCK_STATISTICS),
    } as unknown as CampaignStatisticsRepository;
  });
}

describe("campaignStatistics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns campaign statistics", async () => {
    setupMocks();

    const result = await campaignStatistics({
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(result.campaignId).toBe(42);
    expect(result.totals.successful).toBe(70);
    expect(result.totals.replied).toBe(5);
    expect(result.totals.failed).toBe(10);
    expect(result.totals.skipped).toBe(3);
  });

  it("passes actionId and maxErrors options to repository", async () => {
    setupMocks();

    await campaignStatistics({
      campaignId: 42,
      cdpPort: 9222,
      actionId: 3,
      maxErrors: 5,
    });

    const mockResult = vi.mocked(CampaignStatisticsRepository).mock.results[0] as { value: InstanceType<typeof CampaignStatisticsRepository> };
    expect(mockResult.value.getStatistics).toHaveBeenCalledWith(42, { actionId: 3, maxErrors: 5 });
  });

  it("omits undefined actionId and maxErrors from options", async () => {
    setupMocks();

    await campaignStatistics({
      campaignId: 42,
      cdpPort: 9222,
    });

    const mockResult = vi.mocked(CampaignStatisticsRepository).mock.results[0] as { value: InstanceType<typeof CampaignStatisticsRepository> };
    expect(mockResult.value.getStatistics).toHaveBeenCalledWith(42, {});
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await campaignStatistics({
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

    await campaignStatistics({
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      campaignStatistics({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockRejectedValue(
      new Error("database not found"),
    );

    await expect(
      campaignStatistics({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("database not found");
  });

  it("propagates CampaignStatisticsRepository errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(
      async (_accountId, callback) =>
        callback({ db: {} } as unknown as DatabaseContext),
    );
    vi.mocked(CampaignStatisticsRepository).mockImplementation(function () {
      return {
        getStatistics: vi.fn().mockImplementation(() => {
          throw new Error("statistics error");
        }),
      } as unknown as CampaignStatisticsRepository;
    });

    await expect(
      campaignStatistics({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("statistics error");
  });
});
