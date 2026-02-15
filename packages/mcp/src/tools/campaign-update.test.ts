// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    resolveAccount: vi.fn(),
    withDatabase: vi.fn(),
    CampaignRepository: vi.fn(),
  };
});

import {
  type Campaign,
  CampaignNotFoundError,
  CampaignRepository,
  type DatabaseContext,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";

import { registerCampaignUpdate } from "./campaign-update.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_CAMPAIGN: Campaign = {
  id: 15,
  name: "Updated Campaign",
  description: "Updated description",
  state: "active",
  liAccountId: 1,
  isPaused: false,
  isArchived: false,
  isValid: true,
  createdAt: "2026-02-07T10:00:00Z",
};

function mockCampaignRepo(campaign: Campaign = MOCK_CAMPAIGN) {
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      updateCampaign: vi.fn().mockReturnValue(campaign),
    } as unknown as CampaignRepository;
  });
}

function setupSuccessPath() {
  vi.mocked(resolveAccount).mockResolvedValue(1);
  vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
    callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
  );
  mockCampaignRepo();
}

describe("registerCampaignUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-update", () => {
    const { server } = createMockServer();
    registerCampaignUpdate(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-update",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully updates a campaign name", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignUpdate(server);
    setupSuccessPath();

    const handler = getHandler("campaign-update");
    const result = await handler({
      campaignId: 15,
      name: "Updated Campaign",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(MOCK_CAMPAIGN, null, 2),
        },
      ],
    });
  });

  it("successfully updates a campaign description", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignUpdate(server);
    setupSuccessPath();

    const handler = getHandler("campaign-update");
    const result = await handler({
      campaignId: 15,
      description: "Updated description",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(MOCK_CAMPAIGN, null, 2),
        },
      ],
    });
  });

  it("returns error when no fields provided", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignUpdate(server);

    const handler = getHandler("campaign-update");
    const result = await handler({
      campaignId: 15,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "At least one of name or description must be provided.",
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignUpdate(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
    );
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        updateCampaign: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-update");
    const result = await handler({
      campaignId: 999,
      name: "New Name",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Campaign 999 not found.",
        },
      ],
    });
  });

  describeInfrastructureErrors(
    registerCampaignUpdate,
    "campaign-update",
    () => ({ campaignId: 15, name: "New Name", cdpPort: 9222 }),
    "Failed to connect to LinkedHelper",
  );
});
