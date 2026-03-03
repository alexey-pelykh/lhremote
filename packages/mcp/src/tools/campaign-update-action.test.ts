// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignUpdateAction: vi.fn(),
  };
});

import {
  type CampaignAction,
  ActionNotFoundError,
  CampaignNotFoundError,
  campaignUpdateAction,
} from "@lhremote/core";

import { registerCampaignUpdateAction } from "./campaign-update-action.js";
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
    actionSettings: { extractEmails: true },
    coolDown: 30000,
    maxActionResultsPerIteration: 20,
    isDraft: false,
  },
  versionId: 5000,
};

describe("registerCampaignUpdateAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-update-action", () => {
    const { server } = createMockServer();
    registerCampaignUpdateAction(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-update-action",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully updates action with coolDown", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignUpdateAction(server);
    vi.mocked(campaignUpdateAction).mockResolvedValue(MOCK_ACTION);

    const handler = getHandler("campaign-update-action");
    const result = await handler({
      campaignId: 15,
      actionId: 50,
      coolDown: 30000,
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
    registerCampaignUpdateAction(server);

    const handler = getHandler("campaign-update-action");
    const result = await handler({
      campaignId: 15,
      actionId: 50,
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
    registerCampaignUpdateAction(server);

    vi.mocked(campaignUpdateAction).mockRejectedValue(new CampaignNotFoundError(999));

    const handler = getHandler("campaign-update-action");
    const result = await handler({
      campaignId: 999,
      actionId: 50,
      coolDown: 30000,
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
    registerCampaignUpdateAction(server);

    vi.mocked(campaignUpdateAction).mockRejectedValue(new ActionNotFoundError(999, 15));

    const handler = getHandler("campaign-update-action");
    const result = await handler({
      campaignId: 15,
      actionId: 999,
      coolDown: 30000,
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
    registerCampaignUpdateAction,
    "campaign-update-action",
    () => ({ campaignId: 15, actionId: 50, coolDown: 30000, cdpPort: 9222 }),
    (error) => vi.mocked(campaignUpdateAction).mockRejectedValue(error),
  );
});
