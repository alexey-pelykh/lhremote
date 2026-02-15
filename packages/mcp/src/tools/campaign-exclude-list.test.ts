// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignExcludeList: vi.fn(),
  };
});

import {
  ActionNotFoundError,
  CampaignNotFoundError,
  ExcludeListNotFoundError,
  campaignExcludeList,
} from "@lhremote/core";

import { registerCampaignExcludeList } from "./campaign-exclude-list.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

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

    vi.mocked(campaignExcludeList).mockResolvedValue({
      campaignId: 10,
      level: "campaign",
      count: 2,
      personIds: [1, 2],
    });

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

    vi.mocked(campaignExcludeList).mockResolvedValue({
      campaignId: 10,
      actionId: 5,
      level: "action",
      count: 2,
      personIds: [1, 2],
    });

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

  it("passes correct arguments to operation for campaign-level", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeList(server);

    vi.mocked(campaignExcludeList).mockResolvedValue({
      campaignId: 10,
      level: "campaign",
      count: 0,
      personIds: [],
    });

    const handler = getHandler("campaign-exclude-list");
    await handler({
      campaignId: 10,
      cdpPort: 9222,
    });

    expect(campaignExcludeList).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 10, cdpPort: 9222 }),
    );
  });

  it("passes correct arguments to operation for action-level", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeList(server);

    vi.mocked(campaignExcludeList).mockResolvedValue({
      campaignId: 10,
      actionId: 5,
      level: "action",
      count: 0,
      personIds: [],
    });

    const handler = getHandler("campaign-exclude-list");
    await handler({
      campaignId: 10,
      actionId: 5,
      cdpPort: 9222,
    });

    expect(campaignExcludeList).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 10, actionId: 5, cdpPort: 9222 }),
    );
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeList(server);

    vi.mocked(campaignExcludeList).mockRejectedValue(
      new CampaignNotFoundError(999),
    );

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

    vi.mocked(campaignExcludeList).mockRejectedValue(
      new ActionNotFoundError(5, 10),
    );

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

    vi.mocked(campaignExcludeList).mockRejectedValue(
      new ExcludeListNotFoundError("campaign", 10),
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
          text: "Exclude list not found for campaign 10",
        },
      ],
    });
  });

  describeInfrastructureErrors(
    registerCampaignExcludeList,
    "campaign-exclude-list",
    () => ({ campaignId: 10, cdpPort: 9222 }),
    (error) => vi.mocked(campaignExcludeList).mockRejectedValue(error),
    "Failed to get exclude list",
  );
});
