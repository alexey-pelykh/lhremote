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
  type CampaignAction,
  CampaignNotFoundError,
  CampaignRepository,
  type DatabaseContext,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";

import { registerCampaignGet } from "./campaign-get.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_CAMPAIGN: Campaign = {
  id: 15,
  name: "Outreach Campaign",
  description: "Connect with engineering leaders",
  state: "active",
  liAccountId: 1,
  isPaused: true,
  isArchived: false,
  isValid: true,
  createdAt: "2026-02-07T10:00:00Z",
};

const MOCK_ACTIONS: CampaignAction[] = [
  {
    id: 86,
    campaignId: 15,
    name: "Visit Profile",
    description: null,
    config: {
      id: 100,
      actionType: "VisitAndExtract",
      actionSettings: { extractCurrentOrganizations: true },
      coolDown: 60000,
      maxActionResultsPerIteration: 10,
      isDraft: false,
    },
    versionId: 1,
  },
];

function mockCampaignRepo(
  campaign: Campaign = MOCK_CAMPAIGN,
  actions: CampaignAction[] = MOCK_ACTIONS,
) {
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      getCampaign: vi.fn().mockReturnValue(campaign),
      getCampaignActions: vi.fn().mockReturnValue(actions),
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

describe("registerCampaignGet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-get", () => {
    const { server } = createMockServer();
    registerCampaignGet(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-get",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns campaign details with actions", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignGet(server);
    setupSuccessPath();

    const handler = getHandler("campaign-get");
    const result = await handler({ campaignId: 15, cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { ...MOCK_CAMPAIGN, actions: MOCK_ACTIONS },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignGet(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
    );
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getCampaign: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
        getCampaignActions: vi.fn(),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-get");
    const result = await handler({ campaignId: 999, cdpPort: 9222 });

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
    registerCampaignGet,
    "campaign-get",
    () => ({ campaignId: 15, cdpPort: 9222 }),
    "Failed to connect to LinkedHelper",
  );
});
