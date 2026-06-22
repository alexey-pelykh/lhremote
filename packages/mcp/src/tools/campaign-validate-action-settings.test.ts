// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { registerCampaignValidateActionSettings } from "./campaign-validate-action-settings.js";
import { createMockServer } from "./testing/mock-server.js";

describe("registerCampaignValidateActionSettings", () => {
  it("registers a tool named campaign-validate-action-settings", () => {
    const { server } = createMockServer();
    registerCampaignValidateActionSettings(server);

    expect(server.tool).toHaveBeenCalledWith(
      "campaign-validate-action-settings",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns a valid result for matching settings", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignValidateActionSettings(server);

    const handler = getHandler("campaign-validate-action-settings");
    const result = (await handler({
      actionType: "VisitAndExtract",
      actionSettings: JSON.stringify({ extractCurrentOrganizations: true }),
    })) as { content: [{ text: string }] };

    const payload = JSON.parse(result.content[0].text) as { valid: boolean; issues: unknown[] };
    expect(payload.valid).toBe(true);
    expect(payload.issues).toEqual([]);
  });

  it("returns validation issues for unknown and mismatched settings", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignValidateActionSettings(server);

    const handler = getHandler("campaign-validate-action-settings");
    const result = (await handler({
      actionType: "VisitAndExtract",
      actionSettings: JSON.stringify({ extractCurrentOrganizations: "yes", surprise: true }),
    })) as { content: [{ text: string }] };

    const payload = JSON.parse(result.content[0].text) as { valid: boolean; unknownKeys: string[]; issues: unknown[] };
    expect(payload.valid).toBe(false);
    expect(payload.unknownKeys).toEqual(["surprise"]);
    expect(payload.issues).toHaveLength(2);
  });

  it("returns an error for invalid JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignValidateActionSettings(server);

    const handler = getHandler("campaign-validate-action-settings");
    const result = await handler({
      actionType: "VisitAndExtract",
      actionSettings: "{nope",
    });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Invalid JSON in actionSettings." }],
    });
  });
});
