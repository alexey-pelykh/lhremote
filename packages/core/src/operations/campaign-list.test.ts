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
import { campaignList } from "./campaign-list.js";

const MOCK_CAMPAIGNS = [
  { id: 1, name: "Campaign A" },
  { id: 2, name: "Campaign B" },
  { id: 3, name: "Campaign C" },
];

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      listCampaigns: vi.fn().mockReturnValue(MOCK_CAMPAIGNS),
    } as unknown as CampaignRepository;
  });
}

describe("campaignList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns campaigns with total count", async () => {
    setupMocks();

    const result = await campaignList({
      cdpPort: 9222,
    });

    expect(result.campaigns).toHaveLength(3);
    expect(result.total).toBe(3);
    const firstCampaign = result.campaigns[0] as (typeof result.campaigns)[number];
    expect(firstCampaign.name).toBe("Campaign A");
  });

  it("passes includeArchived to repository", async () => {
    setupMocks();

    await campaignList({
      cdpPort: 9222,
      includeArchived: true,
    });

    const mockResult = vi.mocked(CampaignRepository).mock.results[0] as { value: InstanceType<typeof CampaignRepository> };
    expect(mockResult.value.listCampaigns).toHaveBeenCalledWith({ includeArchived: true });
  });

  it("defaults includeArchived to false", async () => {
    setupMocks();

    await campaignList({
      cdpPort: 9222,
    });

    const mockResult = vi.mocked(CampaignRepository).mock.results[0] as { value: InstanceType<typeof CampaignRepository> };
    expect(mockResult.value.listCampaigns).toHaveBeenCalledWith({ includeArchived: false });
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await campaignList({
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

    await campaignList({
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      campaignList({ cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockRejectedValue(
      new Error("database not found"),
    );

    await expect(
      campaignList({ cdpPort: 9222 }),
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
        listCampaigns: vi.fn().mockImplementation(() => {
          throw new Error("database error");
        }),
      } as unknown as CampaignRepository;
    });

    await expect(
      campaignList({ cdpPort: 9222 }),
    ).rejects.toThrow("database error");
  });
});
