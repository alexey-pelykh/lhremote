// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withDatabase: vi.fn(),
}));

vi.mock("../db/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/index.js")>();
  return {
    ...actual,
    CampaignRepository: vi.fn(),
  };
});

import { ActionNotFoundError, CampaignRepository } from "../db/index.js";
import type { DatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { campaignCloneAction } from "./campaign-clone-action.js";

const SOURCE_ACTION = {
  id: 10,
  campaignId: 42,
  name: "Visit",
  description: "Original",
  config: {
    id: 11,
    actionType: "VisitAndExtract",
    actionSettings: { extractCurrentOrganizations: true },
    coolDown: 60000,
    maxActionResultsPerIteration: 10,
    isDraft: false,
  },
  versionId: 12,
};

const CLONED_ACTION = {
  ...SOURCE_ACTION,
  id: 20,
  name: "Visit again",
  versionId: 21,
};

function setupMocks() {
  const addAction = vi.fn().mockReturnValue(CLONED_ACTION);
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
      getCampaign: vi.fn().mockReturnValue({ id: 42, liAccountId: 7 }),
      getCampaignActions: vi.fn().mockReturnValue([SOURCE_ACTION]),
      addAction,
    } as unknown as CampaignRepository;
  });
  return { addAction };
}

describe("campaignCloneAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("duplicates an action with overrides", async () => {
    const { addAction } = setupMocks();

    const result = await campaignCloneAction({
      campaignId: 42,
      actionId: 10,
      name: "Visit again",
      actionSettingsOverrides: { extractCurrentOrganizations: false },
      cdpPort: 9222,
    });

    expect(result).toBe(CLONED_ACTION);
    expect(addAction).toHaveBeenCalledWith(
      42,
      {
        name: "Visit again",
        actionType: "VisitAndExtract",
        actionSettings: { extractCurrentOrganizations: false },
        coolDown: 60000,
        maxActionResultsPerIteration: 10,
        description: "Original",
      },
      7,
    );
  });

  it("throws ActionNotFoundError when source action is missing", async () => {
    setupMocks();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getCampaign: vi.fn().mockReturnValue({ id: 42, liAccountId: 7 }),
        getCampaignActions: vi.fn().mockReturnValue([]),
      } as unknown as CampaignRepository;
    });

    await expect(
      campaignCloneAction({ campaignId: 42, actionId: 10, cdpPort: 9222 }),
    ).rejects.toBeInstanceOf(ActionNotFoundError);
  });
});
