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
  type CampaignSummary,
  CampaignRepository,
  type DatabaseContext,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";

import { registerCampaignList } from "./campaign-list.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_CAMPAIGNS: CampaignSummary[] = [
  {
    id: 15,
    name: "Outreach Campaign",
    description: "Connect with engineering leaders",
    state: "active",
    liAccountId: 1,
    actionCount: 2,
    createdAt: "2026-02-07T10:00:00Z",
  },
  {
    id: 16,
    name: "Follow-up Campaign",
    description: null,
    state: "paused",
    liAccountId: 1,
    actionCount: 1,
    createdAt: "2026-02-08T10:00:00Z",
  },
];

function mockCampaignRepo(campaigns: CampaignSummary[] = MOCK_CAMPAIGNS) {
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      listCampaigns: vi.fn().mockReturnValue(campaigns),
    } as unknown as CampaignRepository;
  });
}

function setupSuccessPath(campaigns?: CampaignSummary[]) {
  vi.mocked(resolveAccount).mockResolvedValue(1);
  vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
    callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
  );
  mockCampaignRepo(campaigns);
}

describe("registerCampaignList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-list", () => {
    const { server } = createMockServer();
    registerCampaignList(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-list",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns list of campaigns", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignList(server);
    setupSuccessPath();

    const handler = getHandler("campaign-list");
    const result = await handler({ includeArchived: false, cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { campaigns: MOCK_CAMPAIGNS, total: 2 },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("returns empty list when no campaigns", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignList(server);
    setupSuccessPath([]);

    const handler = getHandler("campaign-list");
    const result = await handler({ includeArchived: false, cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ campaigns: [], total: 0 }, null, 2),
        },
      ],
    });
  });

  it("passes includeArchived option to repository", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignList(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
    );

    const listCampaigns = vi.fn().mockReturnValue([]);
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return { listCampaigns } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-list");
    await handler({ includeArchived: true, cdpPort: 9222 });

    expect(listCampaigns).toHaveBeenCalledWith({ includeArchived: true });
  });

  describeInfrastructureErrors(
    registerCampaignList,
    "campaign-list",
    () => ({ includeArchived: false, cdpPort: 9222 }),
    "Failed to connect to LinkedHelper",
  );
});
