// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignMoveNext: vi.fn(),
  };
});

import {
  ActionNotFoundError,
  CampaignNotFoundError,
  NoNextActionError,
  campaignMoveNext,
} from "@lhremote/core";

import { registerCampaignMoveNext } from "./campaign-move-next.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOVE_RESULT = {
  success: true as const,
  campaignId: 10,
  fromActionId: 5,
  toActionId: 6,
  personsMoved: 2,
};

describe("registerCampaignMoveNext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-move-next", () => {
    const { server } = createMockServer();
    registerCampaignMoveNext(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-move-next",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully moves persons to next action", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignMoveNext(server);
    vi.mocked(campaignMoveNext).mockResolvedValue(MOVE_RESULT);

    const handler = getHandler("campaign-move-next");
    const result = await handler({
      campaignId: 10,
      actionId: 5,
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(MOVE_RESULT, null, 2),
        },
      ],
    });
  });

  it("calls campaignMoveNext with correct arguments", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignMoveNext(server);
    vi.mocked(campaignMoveNext).mockResolvedValue(MOVE_RESULT);

    const handler = getHandler("campaign-move-next");
    await handler({
      campaignId: 10,
      actionId: 5,
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(campaignMoveNext).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 10,
        actionId: 5,
        personIds: [100, 200],
        cdpPort: 9222,
      }),
    );
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignMoveNext(server);

    vi.mocked(campaignMoveNext).mockRejectedValue(new CampaignNotFoundError(999));

    const handler = getHandler("campaign-move-next");
    const result = await handler({
      campaignId: 999,
      actionId: 5,
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

  it("returns error for non-existent action", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignMoveNext(server);

    vi.mocked(campaignMoveNext).mockRejectedValue(new ActionNotFoundError(999, 10));

    const handler = getHandler("campaign-move-next");
    const result = await handler({
      campaignId: 10,
      actionId: 999,
      personIds: [100],
      cdpPort: 9222,
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

  it("returns error for last action in chain", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignMoveNext(server);

    vi.mocked(campaignMoveNext).mockRejectedValue(new NoNextActionError(7, 10));

    const handler = getHandler("campaign-move-next");
    const result = await handler({
      campaignId: 10,
      actionId: 7,
      personIds: [100],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Action 7 is the last action in campaign 10.",
        },
      ],
    });
  });

  describeInfrastructureErrors(
    registerCampaignMoveNext,
    "campaign-move-next",
    () => ({ campaignId: 10, actionId: 5, personIds: [100], cdpPort: 9222 }),
    (error) => vi.mocked(campaignMoveNext).mockRejectedValue(error),
  );
});
