// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignList: vi.fn(),
  };
});

import {
  type CampaignSummary,
  campaignList,
} from "@lhremote/core";

import { registerCampaignList } from "./campaign-list.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_CAMPAIGNS: CampaignSummary[] = [
  {
    id: 15,
    name: "Outreach Campaign",
    description: "Connect with engineering leaders",
    state: "active",
    liAccountId: 1,
    actionCount: 2,
    createdAt: "2026-02-07T10:00:00Z",
  },
  {
    id: 16,
    name: "Follow-up Campaign",
    description: null,
    state: "paused",
    liAccountId: 1,
    actionCount: 1,
    createdAt: "2026-02-08T10:00:00Z",
  },
];

describe("registerCampaignList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-list", () => {
    const { server } = createMockServer();
    registerCampaignList(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-list",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns list of campaigns", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignList(server);

    const resultData = { campaigns: MOCK_CAMPAIGNS, total: 2 };
    vi.mocked(campaignList).mockResolvedValue(resultData);

    const handler = getHandler("campaign-list");
    const result = await handler({ includeArchived: false, cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(resultData, null, 2),
        },
      ],
    });
  });

  it("returns empty list when no campaigns", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignList(server);

    const resultData = { campaigns: [], total: 0 };
    vi.mocked(campaignList).mockResolvedValue(resultData);

    const handler = getHandler("campaign-list");
    const result = await handler({ includeArchived: false, cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(resultData, null, 2),
        },
      ],
    });
  });

  it("passes includeArchived option to operation", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignList(server);

    vi.mocked(campaignList).mockResolvedValue({ campaigns: [], total: 0 });

    const handler = getHandler("campaign-list");
    await handler({ includeArchived: true, cdpPort: 9222 });

    expect(campaignList).toHaveBeenCalledWith(
      expect.objectContaining({ includeArchived: true }),
    );
  });

  describeInfrastructureErrors(
    registerCampaignList,
    "campaign-list",
    () => ({ includeArchived: false, cdpPort: 9222 }),
    (error) => vi.mocked(campaignList).mockRejectedValue(error),
    "Failed to list campaigns",
  );
});
