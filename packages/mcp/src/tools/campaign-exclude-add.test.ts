// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignExcludeAdd: vi.fn(),
  };
});

import {
  ActionNotFoundError,
  CampaignNotFoundError,
  ExcludeListNotFoundError,
  campaignExcludeAdd,
} from "@lhremote/core";

import { registerCampaignExcludeAdd } from "./campaign-exclude-add.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

describe("registerCampaignExcludeAdd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-exclude-add", () => {
    const { server } = createMockServer();
    registerCampaignExcludeAdd(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-exclude-add",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully adds people to campaign-level exclude list", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeAdd(server);

    vi.mocked(campaignExcludeAdd).mockResolvedValue({
      success: true,
      campaignId: 10,
      level: "campaign",
      added: 2,
      alreadyExcluded: 0,
    });

    const handler = getHandler("campaign-exclude-add");
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
              added: 2,
              alreadyExcluded: 0,
              message:
                "Added 2 person(s) to exclude list for campaign 10.",
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
    registerCampaignExcludeAdd(server);

    vi.mocked(campaignExcludeAdd).mockResolvedValue({
      success: true,
      campaignId: 10,
      level: "campaign",
      added: 2,
      alreadyExcluded: 0,
    });

    const handler = getHandler("campaign-exclude-add");
    await handler({
      campaignId: 10,
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(campaignExcludeAdd).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 10, personIds: [100, 200], cdpPort: 9222 }),
    );
  });

  it("passes correct arguments to operation for action-level", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeAdd(server);

    vi.mocked(campaignExcludeAdd).mockResolvedValue({
      success: true,
      campaignId: 10,
      actionId: 5,
      level: "action",
      added: 2,
      alreadyExcluded: 0,
    });

    const handler = getHandler("campaign-exclude-add");
    await handler({
      campaignId: 10,
      personIds: [100, 200],
      actionId: 5,
      cdpPort: 9222,
    });

    expect(campaignExcludeAdd).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 10, personIds: [100, 200], actionId: 5, cdpPort: 9222 }),
    );
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeAdd(server);

    vi.mocked(campaignExcludeAdd).mockRejectedValue(
      new CampaignNotFoundError(999),
    );

    const handler = getHandler("campaign-exclude-add");
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
    registerCampaignExcludeAdd(server);

    vi.mocked(campaignExcludeAdd).mockRejectedValue(
      new ActionNotFoundError(5, 10),
    );

    const handler = getHandler("campaign-exclude-add");
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
    registerCampaignExcludeAdd(server);

    vi.mocked(campaignExcludeAdd).mockRejectedValue(
      new ExcludeListNotFoundError("campaign", 10),
    );

    const handler = getHandler("campaign-exclude-add");
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
    registerCampaignExcludeAdd,
    "campaign-exclude-add",
    () => ({ campaignId: 10, personIds: [100, 200], cdpPort: 9222 }),
    (error) => vi.mocked(campaignExcludeAdd).mockRejectedValue(error),
    "Failed to add to exclude list",
  );
});
