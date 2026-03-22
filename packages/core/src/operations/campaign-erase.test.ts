// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

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
import { campaignErase } from "./campaign-erase.js";

function setupMocks(overrides?: { hardDelete?: ReturnType<typeof vi.fn> }) {
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
      hardDelete: overrides?.hardDelete ?? vi.fn(),
    } as unknown as CampaignService;
  });
}

describe("campaignErase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns success with campaignId", async () => {
    setupMocks();

    const result = await campaignErase({
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.campaignId).toBe(42);
  });

  it("calls hardDelete with campaignId", async () => {
    const hardDeleteMock = vi.fn();
    setupMocks({ hardDelete: hardDeleteMock });

    await campaignErase({
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(hardDeleteMock).toHaveBeenCalledWith(42);
  });

  it("passes db readOnly: false to withInstanceDatabase", async () => {
    setupMocks();

    await campaignErase({
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(withInstanceDatabase).toHaveBeenCalledWith(
      9222,
      1,
      expect.any(Function),
      { db: { readOnly: false } },
    );
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await campaignErase({
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

    await campaignErase({
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      campaignErase({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withInstanceDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new Error("instance not running"),
    );

    await expect(
      campaignErase({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("instance not running");
  });

  it("propagates hardDelete errors", async () => {
    const hardDeleteMock = vi.fn().mockImplementation(() => {
      throw new Error("Cannot hard-delete active campaign");
    });
    setupMocks({ hardDelete: hardDeleteMock });

    await expect(
      campaignErase({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("Cannot hard-delete active campaign");
  });
});
