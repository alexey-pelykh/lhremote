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
import { campaignAddAction } from "./campaign-add-action.js";

const MOCK_ACTION = {
  id: 10,
  campaignId: 42,
  name: "Send Connection",
  description: null,
  config: { actionType: "InvitePerson" },
  versionId: 1,
};

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({
        accountId: 1,
        db: {},
      } as unknown as DatabaseContext),
  );

  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      getCampaign: vi.fn().mockReturnValue({ liAccountId: 1 }),
      addAction: vi.fn().mockReturnValue(MOCK_ACTION),
    } as unknown as CampaignRepository;
  });
}

describe("campaignAddAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns created action", async () => {
    setupMocks();

    const result = await campaignAddAction({
      campaignId: 42,
      name: "Send Connection",
      actionType: "InvitePerson",
      cdpPort: 9222,
    });

    expect(result.id).toBe(10);
    expect(result.campaignId).toBe(42);
    expect(result.name).toBe("Send Connection");
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await campaignAddAction({
      campaignId: 42,
      name: "Send Connection",
      actionType: "InvitePerson",
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

    await campaignAddAction({
      campaignId: 42,
      name: "Send Connection",
      actionType: "InvitePerson",
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      campaignAddAction({
        campaignId: 42,
        name: "Send Connection",
        actionType: "InvitePerson",
        cdpPort: 9222,
      }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockRejectedValue(
      new Error("database not found"),
    );

    await expect(
      campaignAddAction({
        campaignId: 42,
        name: "Send Connection",
        actionType: "InvitePerson",
        cdpPort: 9222,
      }),
    ).rejects.toThrow("database not found");
  });

  it("propagates CampaignRepository errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(
      async (_accountId, callback) =>
        callback({
          accountId: 1,
          db: {},
        } as unknown as DatabaseContext),
    );
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getCampaign: vi.fn().mockImplementation(() => {
          throw new Error("campaign not found");
        }),
      } as unknown as CampaignRepository;
    });

    await expect(
      campaignAddAction({
        campaignId: 42,
        name: "Send Connection",
        actionType: "InvitePerson",
        cdpPort: 9222,
      }),
    ).rejects.toThrow("campaign not found");
  });
});
