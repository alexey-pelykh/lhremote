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
import { campaignStop } from "./campaign-stop.js";

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
      stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as CampaignService;
  });
}

describe("campaignStop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns success with campaignId and message", async () => {
    setupMocks();

    const result = await campaignStop({
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.campaignId).toBe(42);
    expect(result.message).toBe("Campaign paused");
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await campaignStop({
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

    await campaignStop({
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      campaignStop({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withInstanceDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new Error("instance not running"),
    );

    await expect(
      campaignStop({ campaignId: 42, cdpPort: 9222 }),
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
        stop: vi.fn().mockRejectedValue(new Error("campaign not found")),
      } as unknown as CampaignService;
    });

    await expect(
      campaignStop({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("campaign not found");
  });
});
