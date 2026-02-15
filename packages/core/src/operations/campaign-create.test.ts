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
import { campaignCreate } from "./campaign-create.js";

const MOCK_CAMPAIGN = {
  id: 1,
  name: "Test Campaign",
  description: null,
  state: "new" as const,
  liAccountId: 1,
  isPaused: false,
  isArchived: false,
  isValid: null,
  createdAt: "2026-01-01T00:00:00Z",
};

const MOCK_CONFIG = {
  name: "Test Campaign",
  actions: [
    {
      name: "Send Connection",
      actionType: "send_connection_request",
      actionSettings: {},
    },
  ],
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
      create: vi.fn().mockResolvedValue(MOCK_CAMPAIGN),
    } as unknown as CampaignService;
  });
}

describe("campaignCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns created campaign", async () => {
    setupMocks();

    const result = await campaignCreate({
      config: MOCK_CONFIG,
      cdpPort: 9222,
    });

    expect(result.id).toBe(1);
    expect(result.name).toBe("Test Campaign");
    expect(result.state).toBe("new");
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await campaignCreate({
      config: MOCK_CONFIG,
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

    await campaignCreate({
      config: MOCK_CONFIG,
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      campaignCreate({ config: MOCK_CONFIG, cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withInstanceDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new Error("instance not running"),
    );

    await expect(
      campaignCreate({ config: MOCK_CONFIG, cdpPort: 9222 }),
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
        create: vi.fn().mockRejectedValue(new Error("invalid config")),
      } as unknown as CampaignService;
    });

    await expect(
      campaignCreate({ config: MOCK_CONFIG, cdpPort: 9222 }),
    ).rejects.toThrow("invalid config");
  });
});
