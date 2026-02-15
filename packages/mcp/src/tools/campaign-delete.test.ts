// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignDelete: vi.fn(),
  };
});

import {
  CampaignExecutionError,
  CampaignNotFoundError,
  campaignDelete,
} from "@lhremote/core";

import { registerCampaignDelete } from "./campaign-delete.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const DELETE_RESULT = { success: true as const, campaignId: 15, action: "archived" as const };

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
    vi.mocked(campaignDelete).mockResolvedValue(DELETE_RESULT);

    const handler = getHandler("campaign-delete");
    const result = await handler({
      campaignId: 15,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(DELETE_RESULT, null, 2),
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignDelete(server);

    vi.mocked(campaignDelete).mockRejectedValue(new CampaignNotFoundError(999));

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
    (error) => vi.mocked(campaignDelete).mockRejectedValue(error),
    "Failed to delete campaign",
  );

  it("returns error when campaign execution fails", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignDelete(server);

    vi.mocked(campaignDelete).mockRejectedValue(
      new CampaignExecutionError(
        "Failed to delete campaign 15: UI error",
        15,
      ),
    );

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
