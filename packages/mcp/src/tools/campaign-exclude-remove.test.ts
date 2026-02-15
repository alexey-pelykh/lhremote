// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignExcludeRemove: vi.fn(),
  };
});

import {
  ActionNotFoundError,
  CampaignNotFoundError,
  ExcludeListNotFoundError,
  campaignExcludeRemove,
} from "@lhremote/core";

import { registerCampaignExcludeRemove } from "./campaign-exclude-remove.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

describe("registerCampaignExcludeRemove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-exclude-remove", () => {
    const { server } = createMockServer();
    registerCampaignExcludeRemove(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-exclude-remove",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully removes people from campaign-level exclude list", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeRemove(server);

    vi.mocked(campaignExcludeRemove).mockResolvedValue({
      success: true,
      campaignId: 10,
      level: "campaign",
      removed: 1,
      notInList: 1,
    });

    const handler = getHandler("campaign-exclude-remove");
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
              level: "campaign",
              removed: 1,
              notInList: 1,
              message:
                "Removed 1 person(s) from exclude list for campaign 10.",
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
    registerCampaignExcludeRemove(server);

    vi.mocked(campaignExcludeRemove).mockResolvedValue({
      success: true,
      campaignId: 10,
      level: "campaign",
      removed: 1,
      notInList: 1,
    });

    const handler = getHandler("campaign-exclude-remove");
    await handler({
      campaignId: 10,
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(campaignExcludeRemove).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 10, personIds: [100, 200], cdpPort: 9222 }),
    );
  });

  it("passes correct arguments to operation for action-level", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeRemove(server);

    vi.mocked(campaignExcludeRemove).mockResolvedValue({
      success: true,
      campaignId: 10,
      actionId: 5,
      level: "action",
      removed: 1,
      notInList: 1,
    });

    const handler = getHandler("campaign-exclude-remove");
    await handler({
      campaignId: 10,
      personIds: [100, 200],
      actionId: 5,
      cdpPort: 9222,
    });

    expect(campaignExcludeRemove).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 10, personIds: [100, 200], actionId: 5, cdpPort: 9222 }),
    );
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeRemove(server);

    vi.mocked(campaignExcludeRemove).mockRejectedValue(
      new CampaignNotFoundError(999),
    );

    const handler = getHandler("campaign-exclude-remove");
    const result = await handler({
      campaignId: 999,
      personIds: [100, 200],
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
    registerCampaignExcludeRemove(server);

    vi.mocked(campaignExcludeRemove).mockRejectedValue(
      new ActionNotFoundError(5, 10),
    );

    const handler = getHandler("campaign-exclude-remove");
    const result = await handler({
      campaignId: 10,
      personIds: [100, 200],
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
    registerCampaignExcludeRemove(server);

    vi.mocked(campaignExcludeRemove).mockRejectedValue(
      new ExcludeListNotFoundError("campaign", 10),
    );

    const handler = getHandler("campaign-exclude-remove");
    const result = await handler({
      campaignId: 10,
      personIds: [100, 200],
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
    registerCampaignExcludeRemove,
    "campaign-exclude-remove",
    () => ({ campaignId: 10, personIds: [100, 200], cdpPort: 9222 }),
    (error) => vi.mocked(campaignExcludeRemove).mockRejectedValue(error),
    "Failed to remove from exclude list",
  );
});
