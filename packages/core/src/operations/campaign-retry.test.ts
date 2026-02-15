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
import { campaignRetry } from "./campaign-retry.js";

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(CampaignStatisticsRepository).mockImplementation(function () {
    return {
      resetForRerun: vi.fn(),
    } as unknown as CampaignStatisticsRepository;
  });
}

describe("campaignRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns retry result with correct fields", async () => {
    setupMocks();

    const result = await campaignRetry({
      campaignId: 42,
      personIds: [100, 101, 102],
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.campaignId).toBe(42);
    expect(result.personsReset).toBe(3);
    expect(result.message).toBe("Persons reset for retry. Use campaign-start to run the campaign.");
  });

  it("passes correct arguments to resetForRerun", async () => {
    setupMocks();

    await campaignRetry({
      campaignId: 42,
      personIds: [100, 101],
      cdpPort: 9222,
    });

    const mockResult = vi.mocked(CampaignStatisticsRepository).mock.results[0] as { value: InstanceType<typeof CampaignStatisticsRepository> };
    expect(mockResult.value.resetForRerun).toHaveBeenCalledWith(42, [100, 101]);
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await campaignRetry({
      campaignId: 42,
      personIds: [100],
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

    await campaignRetry({
      campaignId: 42,
      personIds: [100],
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      campaignRetry({ campaignId: 42, personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockRejectedValue(
      new Error("database not found"),
    );

    await expect(
      campaignRetry({ campaignId: 42, personIds: [100], cdpPort: 9222 }),
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
        resetForRerun: vi.fn().mockImplementation(() => {
          throw new Error("reset failed");
        }),
      } as unknown as CampaignStatisticsRepository;
    });

    await expect(
      campaignRetry({ campaignId: 42, personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("reset failed");
  });
});
