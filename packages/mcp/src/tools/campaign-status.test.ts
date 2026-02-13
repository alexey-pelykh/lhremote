// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignStatus: vi.fn(),
  };
});

import {
  type ActionPeopleCounts,
  AccountResolutionError,
  type CampaignActionResult,
  CampaignExecutionError,
  CampaignNotFoundError,
  InstanceNotRunningError,
  LinkedHelperNotRunningError,
  campaignStatus,
} from "@lhremote/core";

import { registerCampaignStatus } from "./campaign-status.js";
import { createMockServer } from "./testing/mock-server.js";

const defaultStatusResult = {
  campaignId: 15,
  campaignState: "active" as const,
  isPaused: false,
  runnerState: "campaigns" as const,
  actionCounts: [
    { actionId: 1, queued: 10, processed: 5, successful: 4, failed: 1 },
  ] as ActionPeopleCounts[],
};

const defaultResults = [
  {
    id: 1,
    actionVersionId: 1,
    personId: 123,
    result: 3,
    platform: "linkedin",
    createdAt: "2026-02-07T10:00:00Z",
  },
  {
    id: 2,
    actionVersionId: 1,
    personId: 456,
    result: 3,
    platform: "linkedin",
    createdAt: "2026-02-07T10:01:00Z",
  },
] as CampaignActionResult[];

describe("registerCampaignStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-status", () => {
    const { server } = createMockServer();
    registerCampaignStatus(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-status",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns campaign status", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);
    vi.mocked(campaignStatus).mockResolvedValue(defaultStatusResult);

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: false,
      limit: 20,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(defaultStatusResult, null, 2),
        },
      ],
    });
  });

  it("returns campaign status with results when includeResults=true", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);
    vi.mocked(campaignStatus).mockResolvedValue({
      ...defaultStatusResult,
      results: defaultResults,
    });

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: true,
      limit: 20,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ...defaultStatusResult,
              results: defaultResults,
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("limits results when limit is specified", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);
    const singleResult = defaultResults.slice(0, 1);
    vi.mocked(campaignStatus).mockResolvedValue({
      ...defaultStatusResult,
      results: singleResult,
    });

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: true,
      limit: 1,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ...defaultStatusResult,
              results: singleResult,
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
    registerCampaignStatus(server);

    vi.mocked(campaignStatus).mockRejectedValue(new CampaignNotFoundError(999));

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 999,
      includeResults: false,
      limit: 20,
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

  it("returns error when LinkedHelper is not running", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);

    vi.mocked(campaignStatus).mockRejectedValue(
      new LinkedHelperNotRunningError(9222),
    );

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: false,
      limit: 20,
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
    registerCampaignStatus(server);

    vi.mocked(campaignStatus).mockRejectedValue(
      new Error("connection refused"),
    );

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: false,
      limit: 20,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to get campaign status: connection refused",
        },
      ],
    });
  });

  it("returns error when campaign execution fails", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);

    vi.mocked(campaignStatus).mockRejectedValue(
      new CampaignExecutionError(
        "Failed to get status for campaign 15: UI error",
        15,
      ),
    );

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: false,
      limit: 20,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to get campaign status: Failed to get status for campaign 15: UI error",
        },
      ],
    });
  });

  it("returns error when no accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);

    vi.mocked(campaignStatus).mockRejectedValue(
      new AccountResolutionError("no-accounts"),
    );

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: false,
      limit: 20,
      cdpPort: 9222,
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
    registerCampaignStatus(server);

    vi.mocked(campaignStatus).mockRejectedValue(
      new AccountResolutionError("multiple-accounts"),
    );

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: false,
      limit: 20,
      cdpPort: 9222,
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

  it("returns error when no instance is running", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);

    vi.mocked(campaignStatus).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running. Use start-instance first."),
    );

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: false,
      limit: 20,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to get campaign status: No LinkedHelper instance is running. Use start-instance first.",
        },
      ],
    });
  });
});
