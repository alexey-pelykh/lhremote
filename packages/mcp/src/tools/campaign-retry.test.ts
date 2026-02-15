// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignRetry: vi.fn(),
  };
});

import {
  CampaignNotFoundError,
  campaignRetry,
} from "@lhremote/core";

import { registerCampaignRetry } from "./campaign-retry.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const RETRY_RESULT = {
  success: true as const,
  campaignId: 10,
  personsReset: 2,
  message: "Persons reset for retry. Use campaign-start to run the campaign.",
};

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
    vi.mocked(campaignRetry).mockResolvedValue(RETRY_RESULT);

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
          text: JSON.stringify(RETRY_RESULT, null, 2),
        },
      ],
    });
  });

  it("calls campaignRetry with correct arguments", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignRetry(server);
    vi.mocked(campaignRetry).mockResolvedValue(RETRY_RESULT);

    const handler = getHandler("campaign-retry");
    await handler({
      campaignId: 10,
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(campaignRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 10,
        personIds: [100, 200],
        cdpPort: 9222,
      }),
    );
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignRetry(server);

    vi.mocked(campaignRetry).mockRejectedValue(new CampaignNotFoundError(999));

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
    (error) => vi.mocked(campaignRetry).mockRejectedValue(error),
    "Failed to reset persons for retry",
  );
});
