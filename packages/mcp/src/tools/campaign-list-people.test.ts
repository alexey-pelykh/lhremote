// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignListPeople: vi.fn(),
  };
});

import {
  AccountResolutionError,
  ActionNotFoundError,
  CampaignNotFoundError,
  type CampaignListPeopleOutput,
  campaignListPeople,
} from "@lhremote/core";

import { registerCampaignListPeople } from "./campaign-list-people.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const SAMPLE_OUTPUT: CampaignListPeopleOutput = {
  campaignId: 10,
  people: [
    {
      personId: 100,
      firstName: "Alice",
      lastName: "Smith",
      publicId: "alice-smith",
      status: "queued",
      currentActionId: 1,
    },
    {
      personId: 200,
      firstName: "Bob",
      lastName: null,
      publicId: null,
      status: "successful",
      currentActionId: 2,
    },
  ],
  total: 2,
  limit: 20,
  offset: 0,
};

describe("registerCampaignListPeople", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-list-people", () => {
    const { server } = createMockServer();
    registerCampaignListPeople(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-list-people",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns people for a campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignListPeople(server);
    vi.mocked(campaignListPeople).mockResolvedValue(SAMPLE_OUTPUT);

    const handler = getHandler("campaign-list-people");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
      limit: 20,
      offset: 0,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(SAMPLE_OUTPUT, null, 2),
        },
      ],
    });
  });

  it("passes actionId and status to operation", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignListPeople(server);
    vi.mocked(campaignListPeople).mockResolvedValue(SAMPLE_OUTPUT);

    const handler = getHandler("campaign-list-people");
    await handler({
      campaignId: 10,
      actionId: 42,
      status: "queued",
      limit: 20,
      offset: 0,
      cdpPort: 9222,
    });

    expect(campaignListPeople).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 10,
        actionId: 42,
        status: "queued",
      }),
    );
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignListPeople(server);

    vi.mocked(campaignListPeople).mockRejectedValue(
      new CampaignNotFoundError(999),
    );

    const handler = getHandler("campaign-list-people");
    const result = await handler({
      campaignId: 999,
      cdpPort: 9222,
      limit: 20,
      offset: 0,
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
    registerCampaignListPeople(server);

    vi.mocked(campaignListPeople).mockRejectedValue(
      new ActionNotFoundError(999, 10),
    );

    const handler = getHandler("campaign-list-people");
    const result = await handler({
      campaignId: 10,
      actionId: 999,
      cdpPort: 9222,
      limit: 20,
      offset: 0,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Action 999 not found in campaign 10.",
        },
      ],
    });
  });

  describeInfrastructureErrors(
    registerCampaignListPeople,
    "campaign-list-people",
    () => ({ campaignId: 10, cdpPort: 9222, limit: 20, offset: 0 }),
    (error) => vi.mocked(campaignListPeople).mockRejectedValue(error),
    "Failed to list campaign people",
  );

  it("returns error when no accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignListPeople(server);

    vi.mocked(campaignListPeople).mockRejectedValue(
      new AccountResolutionError("no-accounts"),
    );

    const handler = getHandler("campaign-list-people");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
      limit: 20,
      offset: 0,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "No accounts found.",
        },
      ],
    });
  });

  it("returns error when multiple accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignListPeople(server);

    vi.mocked(campaignListPeople).mockRejectedValue(
      new AccountResolutionError("multiple-accounts"),
    );

    const handler = getHandler("campaign-list-people");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
      limit: 20,
      offset: 0,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Multiple accounts found. Cannot determine which instance to use.",
        },
      ],
    });
  });
});
