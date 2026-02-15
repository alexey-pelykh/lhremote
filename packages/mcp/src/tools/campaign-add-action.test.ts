// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignAddAction: vi.fn(),
  };
});

import {
  type CampaignAction,
  CampaignNotFoundError,
  campaignAddAction,
} from "@lhremote/core";

import { registerCampaignAddAction } from "./campaign-add-action.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_ACTION: CampaignAction = {
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
};

describe("registerCampaignAddAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-add-action", () => {
    const { server } = createMockServer();
    registerCampaignAddAction(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-add-action",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully adds action with required params", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignAddAction(server);
    vi.mocked(campaignAddAction).mockResolvedValue(MOCK_ACTION);

    const handler = getHandler("campaign-add-action");
    const result = await handler({
      campaignId: 15,
      name: "Visit & Extract",
      actionType: "VisitAndExtract",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(MOCK_ACTION, null, 2),
        },
      ],
    });
  });

  it("returns error for invalid actionSettings JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignAddAction(server);

    const handler = getHandler("campaign-add-action");
    const result = await handler({
      campaignId: 15,
      name: "Visit & Extract",
      actionType: "VisitAndExtract",
      actionSettings: "{not-valid-json",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Invalid JSON in actionSettings.",
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignAddAction(server);

    vi.mocked(campaignAddAction).mockRejectedValue(new CampaignNotFoundError(999));

    const handler = getHandler("campaign-add-action");
    const result = await handler({
      campaignId: 999,
      name: "Visit",
      actionType: "VisitAndExtract",
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
    registerCampaignAddAction,
    "campaign-add-action",
    () => ({ campaignId: 15, name: "Visit", actionType: "VisitAndExtract", cdpPort: 9222 }),
    (error) => vi.mocked(campaignAddAction).mockRejectedValue(error),
  );
});
