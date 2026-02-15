// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignReorderActions: vi.fn(),
  };
});

import {
  ActionNotFoundError,
  type CampaignAction,
  CampaignNotFoundError,
  InstanceNotRunningError,
  campaignReorderActions,
} from "@lhremote/core";

import { registerCampaignReorderActions } from "./campaign-reorder-actions.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_ACTIONS: CampaignAction[] = [
  {
    id: 50,
    campaignId: 15,
    name: "Visit & Extract",
    description: null,
    config: {
      id: 500,
      actionType: "VisitAndExtract",
      actionSettings: {},
      coolDown: 60000,
      maxActionResultsPerIteration: 10,
      isDraft: false,
    },
    versionId: 5000,
  },
  {
    id: 51,
    campaignId: 15,
    name: "Send Message",
    description: null,
    config: {
      id: 501,
      actionType: "MessageToPerson",
      actionSettings: {},
      coolDown: 60000,
      maxActionResultsPerIteration: 10,
      isDraft: false,
    },
    versionId: 5001,
  },
];

const REORDER_RESULT = {
  success: true as const,
  campaignId: 15,
  actions: MOCK_ACTIONS,
};

describe("registerCampaignReorderActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-reorder-actions", () => {
    const { server } = createMockServer();
    registerCampaignReorderActions(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-reorder-actions",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully reorders actions", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignReorderActions(server);
    vi.mocked(campaignReorderActions).mockResolvedValue(REORDER_RESULT);

    const handler = getHandler("campaign-reorder-actions");
    const result = await handler({
      campaignId: 15,
      actionIds: [51, 50],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(REORDER_RESULT, null, 2),
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignReorderActions(server);

    vi.mocked(campaignReorderActions).mockRejectedValue(new CampaignNotFoundError(999));

    const handler = getHandler("campaign-reorder-actions");
    const result = await handler({
      campaignId: 999,
      actionIds: [50, 51],
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

  it("returns error for invalid action IDs", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignReorderActions(server);

    vi.mocked(campaignReorderActions).mockRejectedValue(new ActionNotFoundError(999, 15));

    const handler = getHandler("campaign-reorder-actions");
    const result = await handler({
      campaignId: 15,
      actionIds: [999, 50],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "One or more action IDs not found in campaign 15.",
        },
      ],
    });
  });

  describeInfrastructureErrors(
    registerCampaignReorderActions,
    "campaign-reorder-actions",
    () => ({ campaignId: 15, actionIds: [50, 51], cdpPort: 9222 }),
    (error) => vi.mocked(campaignReorderActions).mockRejectedValue(error),
  );

  it("returns error when instance is not running", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignReorderActions(server);

    vi.mocked(campaignReorderActions).mockRejectedValue(
      new InstanceNotRunningError("Instance not running"),
    );

    const handler = getHandler("campaign-reorder-actions");
    const result = await handler({
      campaignId: 15,
      actionIds: [50, 51],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to reorder actions: Instance not running",
        },
      ],
    });
  });
});
