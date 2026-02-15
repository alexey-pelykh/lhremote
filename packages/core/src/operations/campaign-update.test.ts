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
  CampaignRepository: vi.fn(),
}));

import type { DatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignRepository } from "../db/index.js";
import { campaignUpdate } from "./campaign-update.js";

const MOCK_UPDATED_CAMPAIGN = {
  id: 42,
  name: "Updated Campaign",
  description: "Updated description",
};

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      updateCampaign: vi.fn().mockReturnValue(MOCK_UPDATED_CAMPAIGN),
    } as unknown as CampaignRepository;
  });
}

describe("campaignUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns updated campaign", async () => {
    setupMocks();

    const result = await campaignUpdate({
      campaignId: 42,
      cdpPort: 9222,
      updates: { name: "Updated Campaign" },
    });

    expect(result.id).toBe(42);
    expect(result.name).toBe("Updated Campaign");
    expect(result.description).toBe("Updated description");
  });

  it("passes campaignId and updates to repository", async () => {
    setupMocks();

    const updates = { name: "New Name", description: "New Desc" };
    await campaignUpdate({
      campaignId: 42,
      cdpPort: 9222,
      updates,
    });

    const mockResult = vi.mocked(CampaignRepository).mock.results[0] as { value: InstanceType<typeof CampaignRepository> };
    expect(mockResult.value.updateCampaign).toHaveBeenCalledWith(42, updates);
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await campaignUpdate({
      campaignId: 42,
      cdpPort: 1234,
      cdpHost: "192.168.1.1",
      allowRemote: true,
      updates: { name: "Test" },
    });

    expect(resolveAccount).toHaveBeenCalledWith(1234, {
      host: "192.168.1.1",
      allowRemote: true,
    });
  });

  it("omits undefined connection options", async () => {
    setupMocks();

    await campaignUpdate({
      campaignId: 42,
      cdpPort: 9222,
      updates: { name: "Test" },
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      campaignUpdate({ campaignId: 42, cdpPort: 9222, updates: { name: "X" } }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockRejectedValue(
      new Error("database not found"),
    );

    await expect(
      campaignUpdate({ campaignId: 42, cdpPort: 9222, updates: { name: "X" } }),
    ).rejects.toThrow("database not found");
  });

  it("propagates CampaignRepository errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(
      async (_accountId, callback) =>
        callback({ db: {} } as unknown as DatabaseContext),
    );
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        updateCampaign: vi.fn().mockImplementation(() => {
          throw new Error("campaign not found");
        }),
      } as unknown as CampaignRepository;
    });

    await expect(
      campaignUpdate({ campaignId: 42, cdpPort: 9222, updates: { name: "X" } }),
    ).rejects.toThrow("campaign not found");
  });
});
