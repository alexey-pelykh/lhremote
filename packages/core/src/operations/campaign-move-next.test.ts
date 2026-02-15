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
import { campaignMoveNext } from "./campaign-move-next.js";

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      moveToNextAction: vi.fn().mockReturnValue({ nextActionId: 5 }),
    } as unknown as CampaignRepository;
  });
}

describe("campaignMoveNext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns move result with correct fields", async () => {
    setupMocks();

    const result = await campaignMoveNext({
      campaignId: 42,
      actionId: 3,
      personIds: [100, 101, 102],
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.campaignId).toBe(42);
    expect(result.fromActionId).toBe(3);
    expect(result.toActionId).toBe(5);
    expect(result.personsMoved).toBe(3);
  });

  it("passes correct arguments to moveToNextAction", async () => {
    setupMocks();

    await campaignMoveNext({
      campaignId: 42,
      actionId: 3,
      personIds: [100, 101],
      cdpPort: 9222,
    });

    const mockResult = vi.mocked(CampaignRepository).mock.results[0] as { value: InstanceType<typeof CampaignRepository> };
    expect(mockResult.value.moveToNextAction).toHaveBeenCalledWith(42, 3, [100, 101]);
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await campaignMoveNext({
      campaignId: 42,
      actionId: 3,
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

    await campaignMoveNext({
      campaignId: 42,
      actionId: 3,
      personIds: [100],
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      campaignMoveNext({ campaignId: 42, actionId: 3, personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockRejectedValue(
      new Error("database not found"),
    );

    await expect(
      campaignMoveNext({ campaignId: 42, actionId: 3, personIds: [100], cdpPort: 9222 }),
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
        moveToNextAction: vi.fn().mockImplementation(() => {
          throw new Error("no next action");
        }),
      } as unknown as CampaignRepository;
    });

    await expect(
      campaignMoveNext({ campaignId: 42, actionId: 3, personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("no next action");
  });
});
