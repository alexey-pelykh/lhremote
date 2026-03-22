// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignErase: vi.fn(),
  };
});

import {
  CampaignExecutionError,
  CampaignNotFoundError,
  campaignErase,
} from "@lhremote/core";

import { registerCampaignErase } from "./campaign-erase.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const ERASE_RESULT = { success: true as const, campaignId: 15 };

describe("registerCampaignErase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-erase", () => {
    const { server } = createMockServer();
    registerCampaignErase(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-erase",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully erases a campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignErase(server);
    vi.mocked(campaignErase).mockResolvedValue(ERASE_RESULT);

    const handler = getHandler("campaign-erase");
    const result = await handler({
      campaignId: 15,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(ERASE_RESULT, null, 2),
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignErase(server);

    vi.mocked(campaignErase).mockRejectedValue(new CampaignNotFoundError(999));

    const handler = getHandler("campaign-erase");
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
    registerCampaignErase,
    "campaign-erase",
    () => ({ campaignId: 15, cdpPort: 9222 }),
    (error) => vi.mocked(campaignErase).mockRejectedValue(error),
    "Failed to erase campaign",
  );

  it("returns error when campaign execution fails", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignErase(server);

    vi.mocked(campaignErase).mockRejectedValue(
      new CampaignExecutionError(
        "Failed to erase campaign 15: campaign is active",
        15,
      ),
    );

    const handler = getHandler("campaign-erase");
    const result = await handler({
      campaignId: 15,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to erase campaign: Failed to erase campaign 15: campaign is active",
        },
      ],
    });
  });
});
