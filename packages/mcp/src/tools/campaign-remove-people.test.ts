// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignRemovePeople: vi.fn(),
  };
});

import {
  CampaignExecutionError,
  CampaignNotFoundError,
  campaignRemovePeople,
} from "@lhremote/core";

import { registerCampaignRemovePeople } from "./campaign-remove-people.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

describe("registerCampaignRemovePeople", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-remove-people", () => {
    const { server } = createMockServer();
    registerCampaignRemovePeople(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-remove-people",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully removes people from campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignRemovePeople(server);

    vi.mocked(campaignRemovePeople).mockResolvedValue({
      success: true,
      campaignId: 14,
      actionId: 85,
      removed: 2,
    });

    const handler = getHandler("campaign-remove-people");
    const result = await handler({
      campaignId: 14,
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
              campaignId: 14,
              actionId: 85,
              removed: 2,
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("passes correct arguments to operation", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignRemovePeople(server);

    vi.mocked(campaignRemovePeople).mockResolvedValue({
      success: true,
      campaignId: 14,
      actionId: 85,
      removed: 1,
    });

    const handler = getHandler("campaign-remove-people");
    await handler({
      campaignId: 14,
      personIds: [100],
      cdpPort: 9222,
    });

    expect(campaignRemovePeople).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 14,
        personIds: [100],
        cdpPort: 9222,
      }),
    );
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignRemovePeople(server);

    vi.mocked(campaignRemovePeople).mockRejectedValue(
      new CampaignNotFoundError(999),
    );

    const handler = getHandler("campaign-remove-people");
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

  it("returns error when campaign has no actions", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignRemovePeople(server);

    vi.mocked(campaignRemovePeople).mockRejectedValue(
      new CampaignExecutionError(
        "Campaign 14 has no actions",
        14,
      ),
    );

    const handler = getHandler("campaign-remove-people");
    const result = await handler({
      campaignId: 14,
      personIds: [100],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to remove people: Campaign 14 has no actions",
        },
      ],
    });
  });

  describeInfrastructureErrors(
    registerCampaignRemovePeople,
    "campaign-remove-people",
    () => ({
      campaignId: 14,
      personIds: [100],
      cdpPort: 9222,
    }),
    (error) => vi.mocked(campaignRemovePeople).mockRejectedValue(error),
    "Failed to remove people",
  );
});
