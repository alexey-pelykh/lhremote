// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignRemoveAction: vi.fn(),
  };
});

import {
  ActionNotFoundError,
  CampaignExecutionError,
  CampaignNotFoundError,
  InstanceNotRunningError,
  campaignRemoveAction,
} from "@lhremote/core";

import { registerCampaignRemoveAction } from "./campaign-remove-action.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const REMOVE_RESULT = { success: true as const, campaignId: 15, removedActionId: 50 };

describe("registerCampaignRemoveAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-remove-action", () => {
    const { server } = createMockServer();
    registerCampaignRemoveAction(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-remove-action",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully removes action", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignRemoveAction(server);
    vi.mocked(campaignRemoveAction).mockResolvedValue(REMOVE_RESULT);

    const handler = getHandler("campaign-remove-action");
    const result = await handler({
      campaignId: 15,
      actionId: 50,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(REMOVE_RESULT, null, 2),
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignRemoveAction(server);

    vi.mocked(campaignRemoveAction).mockRejectedValue(new CampaignNotFoundError(999));

    const handler = getHandler("campaign-remove-action");
    const result = await handler({
      campaignId: 999,
      actionId: 50,
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
    registerCampaignRemoveAction(server);

    vi.mocked(campaignRemoveAction).mockRejectedValue(new ActionNotFoundError(999, 15));

    const handler = getHandler("campaign-remove-action");
    const result = await handler({
      campaignId: 15,
      actionId: 999,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Action 999 not found in campaign 15.",
        },
      ],
    });
  });

  describeInfrastructureErrors(
    registerCampaignRemoveAction,
    "campaign-remove-action",
    () => ({ campaignId: 15, actionId: 50, cdpPort: 9222 }),
    (error) => vi.mocked(campaignRemoveAction).mockRejectedValue(error),
  );

  it("returns error when instance is not running", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignRemoveAction(server);

    vi.mocked(campaignRemoveAction).mockRejectedValue(
      new InstanceNotRunningError("Instance not running"),
    );

    const handler = getHandler("campaign-remove-action");
    const result = await handler({
      campaignId: 15,
      actionId: 50,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to remove action: Instance not running",
        },
      ],
    });
  });

  it("returns error when CDP call fails", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignRemoveAction(server);

    vi.mocked(campaignRemoveAction).mockRejectedValue(
      new CampaignExecutionError(
        "Failed to remove action 50 from campaign 15: UI error",
        15,
      ),
    );

    const handler = getHandler("campaign-remove-action");
    const result = await handler({
      campaignId: 15,
      actionId: 50,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to remove action: Failed to remove action 50 from campaign 15: UI error",
        },
      ],
    });
  });
});
