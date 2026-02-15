// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignExport: vi.fn(),
  };
});

import {
  CampaignNotFoundError,
  campaignExport,
} from "@lhremote/core";

import { registerCampaignExport } from "./campaign-export.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

describe("registerCampaignExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-export", () => {
    const { server } = createMockServer();
    registerCampaignExport(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-export",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("exports campaign as YAML by default", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExport(server);

    const yamlOutput = 'version: "1"\nname: Outreach Campaign\n';
    const exportResult = { campaignId: 15, format: "yaml" as const, config: yamlOutput };
    vi.mocked(campaignExport).mockResolvedValue(exportResult);

    const handler = getHandler("campaign-export");
    const result = await handler({ campaignId: 15, format: "yaml", cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(exportResult, null, 2),
        },
      ],
    });
  });

  it("exports campaign as JSON when requested", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExport(server);

    const jsonOutput = '{\n  "version": "1",\n  "name": "Outreach Campaign"\n}\n';
    const exportResult = { campaignId: 15, format: "json" as const, config: jsonOutput };
    vi.mocked(campaignExport).mockResolvedValue(exportResult);

    const handler = getHandler("campaign-export");
    const result = await handler({ campaignId: 15, format: "json", cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(exportResult, null, 2),
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExport(server);

    vi.mocked(campaignExport).mockRejectedValue(new CampaignNotFoundError(999));

    const handler = getHandler("campaign-export");
    const result = await handler({ campaignId: 999, format: "yaml", cdpPort: 9222 });

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
    registerCampaignExport,
    "campaign-export",
    () => ({ campaignId: 15, format: "yaml", cdpPort: 9222 }),
    (error) => vi.mocked(campaignExport).mockRejectedValue(error),
    "Failed to export campaign",
  );
});
