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
  CampaignExcludeListRepository: vi.fn(),
}));

import type { DatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignExcludeListRepository } from "../db/index.js";
import { campaignExcludeRemove } from "./campaign-exclude-remove.js";

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(CampaignExcludeListRepository).mockImplementation(function () {
    return {
      removeFromExcludeList: vi.fn().mockReturnValue(2),
    } as unknown as CampaignExcludeListRepository;
  });
}

describe("campaignExcludeRemove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes people from campaign-level exclude list", async () => {
    setupMocks();

    const result = await campaignExcludeRemove({
      campaignId: 42,
      personIds: [100, 101, 102],
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.campaignId).toBe(42);
    expect(result.level).toBe("campaign");
    expect(result.removed).toBe(2);
    expect(result.notInList).toBe(1);
    expect(result.actionId).toBeUndefined();
  });

  it("removes people from action-level exclude list when actionId is provided", async () => {
    setupMocks();

    const result = await campaignExcludeRemove({
      campaignId: 42,
      personIds: [100, 101],
      actionId: 7,
      cdpPort: 9222,
    });

    expect(result.level).toBe("action");
    expect(result.actionId).toBe(7);
    expect(result.removed).toBe(2);
    expect(result.notInList).toBe(0);
  });

  it("passes readOnly: false to withDatabase", async () => {
    setupMocks();

    await campaignExcludeRemove({
      campaignId: 42,
      personIds: [100],
      cdpPort: 9222,
    });

    expect(withDatabase).toHaveBeenCalledWith(
      1,
      expect.any(Function),
      { readOnly: false },
    );
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await campaignExcludeRemove({
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

    await campaignExcludeRemove({
      campaignId: 42,
      personIds: [100],
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      campaignExcludeRemove({ campaignId: 42, personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockRejectedValue(
      new Error("database not found"),
    );

    await expect(
      campaignExcludeRemove({ campaignId: 42, personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("database not found");
  });

  it("propagates CampaignExcludeListRepository errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(
      async (_accountId, callback) =>
        callback({ db: {} } as unknown as DatabaseContext),
    );
    vi.mocked(CampaignExcludeListRepository).mockImplementation(function () {
      return {
        removeFromExcludeList: vi.fn().mockImplementation(() => {
          throw new Error("campaign not found");
        }),
      } as unknown as CampaignExcludeListRepository;
    });

    await expect(
      campaignExcludeRemove({ campaignId: 42, personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("campaign not found");
  });
});
