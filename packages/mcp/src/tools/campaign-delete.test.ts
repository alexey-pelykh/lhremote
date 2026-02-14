// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

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
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  type InstanceDatabaseContext,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

import { registerCampaignDelete } from "./campaign-delete.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

function mockCampaignService() {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      delete: vi.fn().mockResolvedValue(undefined),
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

describe("registerCampaignDelete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-delete", () => {
    const { server } = createMockServer();
    registerCampaignDelete(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-delete",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully deletes a campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignDelete(server);
    setupSuccessPath();

    const handler = getHandler("campaign-delete");
    const result = await handler({
      campaignId: 15,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { success: true, campaignId: 15, action: "archived" },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignDelete(server);

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
        delete: vi.fn().mockRejectedValue(new CampaignNotFoundError(999)),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-delete");
    const result = await handler({
      campaignId: 999,
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
    registerCampaignDelete,
    "campaign-delete",
    () => ({ campaignId: 15, cdpPort: 9222 }),
    "Failed to connect to LinkedHelper",
  );

  it("returns error when campaign execution fails", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignDelete(server);

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
        delete: vi
          .fn()
          .mockRejectedValue(
            new CampaignExecutionError(
              "Failed to delete campaign 15: UI error",
              15,
            ),
          ),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-delete");
    const result = await handler({
      campaignId: 15,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to delete campaign: Failed to delete campaign 15: UI error",
        },
      ],
    });
  });
});
