// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

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
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  type DatabaseContext,
  ExcludeListNotFoundError,
  LinkedHelperNotRunningError,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";

import { registerCampaignExcludeList } from "./campaign-exclude-list.js";
import { createMockServer } from "./testing/mock-server.js";

function mockCampaignRepo() {
  const getExcludeList = vi
    .fn()
    .mockReturnValue([{ personId: 1 }, { personId: 2 }]);
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      getExcludeList,
    } as unknown as CampaignRepository;
  });
  return { getExcludeList };
}

function setupSuccessPath() {
  vi.mocked(resolveAccount).mockResolvedValue(1);
  vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
    callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
  );
  mockCampaignRepo();
}

describe("registerCampaignExcludeList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-exclude-list", () => {
    const { server } = createMockServer();
    registerCampaignExcludeList(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-exclude-list",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully returns campaign-level exclude list", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeList(server);
    setupSuccessPath();

    const handler = getHandler("campaign-exclude-list");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              campaignId: 10,
              level: "campaign",
              count: 2,
              personIds: [1, 2],
              message:
                "Exclude list for campaign 10: 2 person(s).",
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("successfully returns action-level exclude list", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeList(server);
    setupSuccessPath();

    const handler = getHandler("campaign-exclude-list");
    const result = await handler({
      campaignId: 10,
      actionId: 5,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              campaignId: 10,
              actionId: 5,
              level: "action",
              count: 2,
              personIds: [1, 2],
              message:
                "Exclude list for action 5 in campaign 10: 2 person(s).",
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("calls getExcludeList with correct arguments for campaign-level", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeList(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
    );
    const { getExcludeList } = mockCampaignRepo();

    const handler = getHandler("campaign-exclude-list");
    await handler({
      campaignId: 10,
      cdpPort: 9222,
    });

    expect(getExcludeList).toHaveBeenCalledWith(10, undefined);
  });

  it("calls getExcludeList with correct arguments for action-level", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeList(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
    );
    const { getExcludeList } = mockCampaignRepo();

    const handler = getHandler("campaign-exclude-list");
    await handler({
      campaignId: 10,
      actionId: 5,
      cdpPort: 9222,
    });

    expect(getExcludeList).toHaveBeenCalledWith(10, 5);
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeList(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
    );
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getExcludeList: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-exclude-list");
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

  it("returns error for non-existent action", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeList(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
    );
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getExcludeList: vi.fn().mockImplementation(() => {
          throw new ActionNotFoundError(5, 10);
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-exclude-list");
    const result = await handler({
      campaignId: 10,
      actionId: 5,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Action 5 not found in campaign 10.",
        },
      ],
    });
  });

  it("returns error for non-existent exclude list", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeList(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
    );
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getExcludeList: vi.fn().mockImplementation(() => {
          throw new ExcludeListNotFoundError("campaign", 10);
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-exclude-list");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Exclude list not found for campaign 10",
        },
      ],
    });
  });

  it("returns error when LinkedHelper is not running", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeList(server);

    vi.mocked(resolveAccount).mockRejectedValue(
      new LinkedHelperNotRunningError(9222),
    );

    const handler = getHandler("campaign-exclude-list");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "LinkedHelper is not running. Use launch-app first.",
        },
      ],
    });
  });

  it("returns error when connection fails", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeList(server);

    vi.mocked(resolveAccount).mockRejectedValue(
      new Error("connection refused"),
    );

    const handler = getHandler("campaign-exclude-list");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to connect to LinkedHelper: connection refused",
        },
      ],
    });
  });
});
