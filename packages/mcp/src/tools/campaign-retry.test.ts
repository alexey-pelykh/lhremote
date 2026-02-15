// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    resolveAccount: vi.fn(),
    withDatabase: vi.fn(),
    CampaignStatisticsRepository: vi.fn(),
  };
});

import {
  CampaignNotFoundError,
  CampaignStatisticsRepository,
  type DatabaseContext,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";

import { registerCampaignRetry } from "./campaign-retry.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

function mockCampaignRepo() {
  const resetForRerun = vi.fn();
  vi.mocked(CampaignStatisticsRepository).mockImplementation(function () {
    return {
      resetForRerun,
    } as unknown as CampaignStatisticsRepository;
  });
  return { resetForRerun };
}

function setupSuccessPath() {
  vi.mocked(resolveAccount).mockResolvedValue(1);
  vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
    callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
  );
  mockCampaignRepo();
}

describe("registerCampaignRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-retry", () => {
    const { server } = createMockServer();
    registerCampaignRetry(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-retry",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully resets persons for retry", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignRetry(server);
    setupSuccessPath();

    const handler = getHandler("campaign-retry");
    const result = await handler({
      campaignId: 10,
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              campaignId: 10,
              personsReset: 2,
              message:
                "Persons reset for retry. Use campaign-start to run the campaign.",
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("calls resetForRerun with correct arguments", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignRetry(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
    );
    const { resetForRerun } = mockCampaignRepo();

    const handler = getHandler("campaign-retry");
    await handler({
      campaignId: 10,
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(resetForRerun).toHaveBeenCalledWith(10, [100, 200]);
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignRetry(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
    );
    vi.mocked(CampaignStatisticsRepository).mockImplementation(function () {
      return {
        resetForRerun: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
      } as unknown as CampaignStatisticsRepository;
    });

    const handler = getHandler("campaign-retry");
    const result = await handler({
      campaignId: 999,
      personIds: [100],
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
    registerCampaignRetry,
    "campaign-retry",
    () => ({ campaignId: 10, personIds: [100], cdpPort: 9222 }),
    "Failed to connect to LinkedHelper",
  );
});
