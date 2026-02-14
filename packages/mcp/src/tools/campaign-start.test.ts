// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

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
  CampaignTimeoutError,
  type InstanceDatabaseContext,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

import { registerCampaignStart } from "./campaign-start.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

function mockCampaignService() {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      start: vi.fn().mockResolvedValue(undefined),
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

describe("registerCampaignStart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-start", () => {
    const { server } = createMockServer();
    registerCampaignStart(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-start",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully starts a campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStart(server);
    setupSuccessPath();

    const handler = getHandler("campaign-start");
    const result = await handler({
      campaignId: 15,
      personIds: [100, 200, 300],
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
              personsQueued: 3,
              message:
                "Campaign started. Use campaign-status to monitor progress.",
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
    registerCampaignStart(server);

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
        start: vi.fn().mockRejectedValue(new CampaignNotFoundError(999)),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-start");
    const result = await handler({
      campaignId: 999,
      personIds: [1],
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
    registerCampaignStart,
    "campaign-start",
    () => ({ campaignId: 15, personIds: [1], cdpPort: 9222 }),
    "Failed to connect to LinkedHelper",
  );

  it("returns error when campaign runner times out", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStart(server);

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
        start: vi
          .fn()
          .mockRejectedValue(
            new CampaignTimeoutError(
              "Campaign runner did not reach idle state within 60000ms",
              15,
            ),
          ),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-start");
    const result = await handler({
      campaignId: 15,
      personIds: [1],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Campaign start timed out: Campaign runner did not reach idle state within 60000ms",
        },
      ],
    });
  });

  it("returns error when campaign execution fails", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStart(server);

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
        start: vi
          .fn()
          .mockRejectedValue(
            new CampaignExecutionError(
              "Failed to unpause campaign 15: UI error",
              15,
            ),
          ),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-start");
    const result = await handler({
      campaignId: 15,
      personIds: [1],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to start campaign: Failed to unpause campaign 15: UI error",
        },
      ],
    });
  });
});
