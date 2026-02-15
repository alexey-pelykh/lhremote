// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignStatistics: vi.fn(),
  };
});

import {
  AccountResolutionError,
  ActionNotFoundError,
  CampaignNotFoundError,
  type CampaignStatistics,
  campaignStatistics,
} from "@lhremote/core";

import { registerCampaignStatistics } from "./campaign-statistics.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const SAMPLE_STATISTICS: CampaignStatistics = {
  campaignId: 10,
  actions: [
    {
      actionId: 1,
      actionName: "Invite",
      actionType: "InvitePerson",
      successful: 50,
      replied: 0,
      failed: 5,
      skipped: 0,
      total: 55,
      successRate: 90.9,
      firstResultAt: "2026-01-01T00:00:00Z",
      lastResultAt: "2026-01-15T00:00:00Z",
      topErrors: [
        { code: 270013, count: 3, isException: false, whoToBlame: "LinkedIn" },
        { code: 271403, count: 2, isException: false, whoToBlame: "LinkedIn" },
      ],
    },
  ],
  totals: {
    successful: 50,
    replied: 0,
    failed: 5,
    skipped: 0,
    total: 55,
    successRate: 90.9,
  },
};

describe("registerCampaignStatistics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-statistics", () => {
    const { server } = createMockServer();
    registerCampaignStatistics(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-statistics",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns statistics for a campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);
    vi.mocked(campaignStatistics).mockResolvedValue(SAMPLE_STATISTICS);

    const handler = getHandler("campaign-statistics");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
      maxErrors: 5,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(SAMPLE_STATISTICS, null, 2),
        },
      ],
    });
  });

  it("passes actionId and maxErrors to operation", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);
    vi.mocked(campaignStatistics).mockResolvedValue(SAMPLE_STATISTICS);

    const handler = getHandler("campaign-statistics");
    await handler({
      campaignId: 10,
      actionId: 42,
      maxErrors: 3,
      cdpPort: 9222,
    });

    expect(campaignStatistics).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 10,
        actionId: 42,
        maxErrors: 3,
      }),
    );
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);

    vi.mocked(campaignStatistics).mockRejectedValue(new CampaignNotFoundError(999));

    const handler = getHandler("campaign-statistics");
    const result = await handler({
      campaignId: 999,
      cdpPort: 9222,
      maxErrors: 5,
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
    registerCampaignStatistics(server);

    vi.mocked(campaignStatistics).mockRejectedValue(new ActionNotFoundError(999, 10));

    const handler = getHandler("campaign-statistics");
    const result = await handler({
      campaignId: 10,
      actionId: 999,
      cdpPort: 9222,
      maxErrors: 5,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Action 999 not found in campaign 10.",
        },
      ],
    });
  });

  describeInfrastructureErrors(
    registerCampaignStatistics,
    "campaign-statistics",
    () => ({ campaignId: 10, cdpPort: 9222, maxErrors: 5 }),
    (error) => vi.mocked(campaignStatistics).mockRejectedValue(error),
    "Failed to get campaign statistics",
  );

  it("returns error when no accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);

    vi.mocked(campaignStatistics).mockRejectedValue(
      new AccountResolutionError("no-accounts"),
    );

    const handler = getHandler("campaign-statistics");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
      maxErrors: 5,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "No accounts found.",
        },
      ],
    });
  });

  it("returns error when multiple accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);

    vi.mocked(campaignStatistics).mockRejectedValue(
      new AccountResolutionError("multiple-accounts"),
    );

    const handler = getHandler("campaign-statistics");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
      maxErrors: 5,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Multiple accounts found. Cannot determine which instance to use.",
        },
      ],
    });
  });
});
