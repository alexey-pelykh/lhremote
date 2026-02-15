// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignStop: vi.fn(),
  };
});

import {
  CampaignExecutionError,
  CampaignNotFoundError,
  campaignStop,
} from "@lhremote/core";

import { registerCampaignStop } from "./campaign-stop.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const STOP_RESULT = {
  success: true as const,
  campaignId: 15,
  message: "Campaign paused",
};

describe("registerCampaignStop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-stop", () => {
    const { server } = createMockServer();
    registerCampaignStop(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-stop",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully stops a campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStop(server);
    vi.mocked(campaignStop).mockResolvedValue(STOP_RESULT);

    const handler = getHandler("campaign-stop");
    const result = await handler({
      campaignId: 15,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(STOP_RESULT, null, 2),
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStop(server);

    vi.mocked(campaignStop).mockRejectedValue(new CampaignNotFoundError(999));

    const handler = getHandler("campaign-stop");
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
    registerCampaignStop,
    "campaign-stop",
    () => ({ campaignId: 15, cdpPort: 9222 }),
    (error) => vi.mocked(campaignStop).mockRejectedValue(error),
    "Failed to stop campaign",
  );

  it("returns error when campaign execution fails", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStop(server);

    vi.mocked(campaignStop).mockRejectedValue(
      new CampaignExecutionError(
        "Failed to stop campaign 15: UI error",
        15,
      ),
    );

    const handler = getHandler("campaign-stop");
    const result = await handler({
      campaignId: 15,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to stop campaign: Failed to stop campaign 15: UI error",
        },
      ],
    });
  });
});
