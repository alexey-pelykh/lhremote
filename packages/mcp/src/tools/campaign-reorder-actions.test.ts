// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    resolveAccount: vi.fn(),
    withInstanceDatabase: vi.fn(),
    CampaignService: vi.fn(),
  };
});

import {
  ActionNotFoundError,
  type CampaignAction,
  CampaignNotFoundError,
  CampaignService,
  type InstanceDatabaseContext,
  InstanceNotRunningError,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

import { registerCampaignReorderActions } from "./campaign-reorder-actions.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_ACTIONS: CampaignAction[] = [
  {
    id: 50,
    campaignId: 15,
    name: "Visit & Extract",
    description: null,
    config: {
      id: 500,
      actionType: "VisitAndExtract",
      actionSettings: {},
      coolDown: 60000,
      maxActionResultsPerIteration: 10,
      isDraft: false,
    },
    versionId: 5000,
  },
  {
    id: 51,
    campaignId: 15,
    name: "Send Message",
    description: null,
    config: {
      id: 501,
      actionType: "MessageToPerson",
      actionSettings: {},
      coolDown: 60000,
      maxActionResultsPerIteration: 10,
      isDraft: false,
    },
    versionId: 5001,
  },
];

function mockCampaignService(actions: CampaignAction[] = MOCK_ACTIONS) {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      reorderActions: vi.fn().mockResolvedValue(actions),
    } as unknown as CampaignService;
  });
}

function setupSuccessPath() {
  vi.mocked(resolveAccount).mockResolvedValue(1);
  vi.mocked(withInstanceDatabase).mockImplementation(
    async (_cdpPort, _accountId, callback) =>
      callback({
        accountId: 1,
        instance: {},
        db: {},
      } as unknown as InstanceDatabaseContext),
  );
  mockCampaignService();
}

describe("registerCampaignReorderActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-reorder-actions", () => {
    const { server } = createMockServer();
    registerCampaignReorderActions(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-reorder-actions",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully reorders actions", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignReorderActions(server);
    setupSuccessPath();

    const handler = getHandler("campaign-reorder-actions");
    const result = await handler({
      campaignId: 15,
      actionIds: [51, 50],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              campaignId: 15,
              actions: MOCK_ACTIONS,
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignReorderActions(server);

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
        reorderActions: vi
          .fn()
          .mockRejectedValue(new CampaignNotFoundError(999)),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-reorder-actions");
    const result = await handler({
      campaignId: 999,
      actionIds: [50, 51],
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

  it("returns error for invalid action IDs", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignReorderActions(server);

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
        reorderActions: vi
          .fn()
          .mockRejectedValue(new ActionNotFoundError(999, 15)),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-reorder-actions");
    const result = await handler({
      campaignId: 15,
      actionIds: [999, 50],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "One or more action IDs not found in campaign 15.",
        },
      ],
    });
  });

  describeInfrastructureErrors(
    registerCampaignReorderActions,
    "campaign-reorder-actions",
    () => ({ campaignId: 15, actionIds: [50, 51], cdpPort: 9222 }),
  );

  it("returns error when instance is not running", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignReorderActions(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new InstanceNotRunningError("Instance not running"),
    );

    const handler = getHandler("campaign-reorder-actions");
    const result = await handler({
      campaignId: 15,
      actionIds: [50, 51],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to reorder actions: Instance not running",
        },
      ],
    });
  });
});
