// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

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
import { campaignGet } from "./campaign-get.js";

const MOCK_CAMPAIGN = {
  id: 42,
  name: "Test Campaign",
  description: "A test campaign",
};

const MOCK_ACTIONS = [
  { id: 1, campaignId: 42, name: "Visit", description: null, config: { id: 1, actionType: "visit", actionSettings: {}, coolDown: 60000, maxActionResultsPerIteration: 10, isDraft: false }, versionId: 1 },
  { id: 2, campaignId: 42, name: "Connect", description: null, config: { id: 2, actionType: "connect", actionSettings: {}, coolDown: 60000, maxActionResultsPerIteration: 10, isDraft: false }, versionId: 1 },
];

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      getCampaign: vi.fn().mockReturnValue(MOCK_CAMPAIGN),
      getCampaignActions: vi.fn().mockReturnValue(MOCK_ACTIONS),
    } as unknown as CampaignRepository;
  });
}

describe("campaignGet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns campaign with actions", async () => {
    setupMocks();

    const result = await campaignGet({
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(result.id).toBe(42);
    expect(result.name).toBe("Test Campaign");
    expect(result.actions).toHaveLength(2);
    const firstAction = result.actions[0] as (typeof result.actions)[number];
    expect(firstAction.config.actionType).toBe("visit");
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await campaignGet({
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

    await campaignGet({
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      campaignGet({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockRejectedValue(
      new Error("database not found"),
    );

    await expect(
      campaignGet({ campaignId: 42, cdpPort: 9222 }),
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
        getCampaign: vi.fn().mockImplementation(() => {
          throw new Error("campaign not found");
        }),
        getCampaignActions: vi.fn(),
      } as unknown as CampaignRepository;
    });

    await expect(
      campaignGet({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("campaign not found");
  });
});
