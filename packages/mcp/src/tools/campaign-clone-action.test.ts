// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@insoftex/lhremote-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@insoftex/lhremote-core")>();
  return {
    ...actual,
    campaignCloneAction: vi.fn(),
  };
});

import { ActionNotFoundError, campaignCloneAction, type CampaignAction } from "@insoftex/lhremote-core";

import { registerCampaignCloneAction } from "./campaign-clone-action.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_ACTION: CampaignAction = {
  id: 99,
  campaignId: 42,
  name: "Visit copy",
  description: null,
  config: {
    id: 100,
    actionType: "VisitAndExtract",
    actionSettings: { extractCurrentOrganizations: true },
    coolDown: 60000,
    maxActionResultsPerIteration: 10,
    isDraft: false,
  },
  versionId: 101,
};

describe("registerCampaignCloneAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-clone-action", () => {
    const { server } = createMockServer();
    registerCampaignCloneAction(server);

    expect(server.tool).toHaveBeenCalledWith(
      "campaign-clone-action",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("passes clone arguments to the operation", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignCloneAction(server);
    vi.mocked(campaignCloneAction).mockResolvedValue(MOCK_ACTION);

    const handler = getHandler("campaign-clone-action");
    await handler({
      campaignId: 42,
      actionId: 10,
      name: "Visit again",
      actionSettingsOverrides: JSON.stringify({ extractCurrentOrganizations: false }),
      cdpPort: 9222,
    });

    expect(campaignCloneAction).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: 42,
      actionId: 10,
      name: "Visit again",
      actionSettingsOverrides: { extractCurrentOrganizations: false },
      cdpPort: 9222,
    }));
  });

  it("returns an error for invalid override JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignCloneAction(server);

    const handler = getHandler("campaign-clone-action");
    const result = await handler({
      campaignId: 42,
      actionId: 10,
      actionSettingsOverrides: "{nope",
    });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Invalid JSON in actionSettingsOverrides." }],
    });
  });

  it("returns an action-not-found error", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignCloneAction(server);
    vi.mocked(campaignCloneAction).mockRejectedValue(new ActionNotFoundError(10, 42));

    const handler = getHandler("campaign-clone-action");
    const result = await handler({ campaignId: 42, actionId: 10 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Action 10 not found in campaign 42." }],
    });
  });
});
