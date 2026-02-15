// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withDatabase: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  CampaignRepository: vi.fn(),
}));

vi.mock("../formats/index.js", () => ({
  serializeCampaignJson: vi.fn(),
  serializeCampaignYaml: vi.fn(),
}));

import type { DatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignRepository } from "../db/index.js";
import { serializeCampaignJson, serializeCampaignYaml } from "../formats/index.js";
import { campaignExport } from "./campaign-export.js";

const MOCK_CAMPAIGN = {
  id: 42,
  name: "Test Campaign",
};

const MOCK_ACTIONS = [
  { id: 1, actionType: "visit", position: 0 },
];

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      getCampaign: vi.fn().mockReturnValue(MOCK_CAMPAIGN),
      getCampaignActions: vi.fn().mockReturnValue(MOCK_ACTIONS),
    } as unknown as CampaignRepository;
  });

  vi.mocked(serializeCampaignJson).mockReturnValue('{"campaign":"json"}');
  vi.mocked(serializeCampaignYaml).mockReturnValue("campaign: yaml");
}

describe("campaignExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports campaign as JSON", async () => {
    setupMocks();

    const result = await campaignExport({
      campaignId: 42,
      cdpPort: 9222,
      format: "json",
    });

    expect(result.campaignId).toBe(42);
    expect(result.format).toBe("json");
    expect(result.config).toBe('{"campaign":"json"}');
    expect(serializeCampaignJson).toHaveBeenCalledWith(MOCK_CAMPAIGN, MOCK_ACTIONS);
    expect(serializeCampaignYaml).not.toHaveBeenCalled();
  });

  it("exports campaign as YAML", async () => {
    setupMocks();

    const result = await campaignExport({
      campaignId: 42,
      cdpPort: 9222,
      format: "yaml",
    });

    expect(result.campaignId).toBe(42);
    expect(result.format).toBe("yaml");
    expect(result.config).toBe("campaign: yaml");
    expect(serializeCampaignYaml).toHaveBeenCalledWith(MOCK_CAMPAIGN, MOCK_ACTIONS);
    expect(serializeCampaignJson).not.toHaveBeenCalled();
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await campaignExport({
      campaignId: 42,
      cdpPort: 1234,
      cdpHost: "192.168.1.1",
      allowRemote: true,
      format: "json",
    });

    expect(resolveAccount).toHaveBeenCalledWith(1234, {
      host: "192.168.1.1",
      allowRemote: true,
    });
  });

  it("omits undefined connection options", async () => {
    setupMocks();

    await campaignExport({
      campaignId: 42,
      cdpPort: 9222,
      format: "json",
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      campaignExport({ campaignId: 42, cdpPort: 9222, format: "json" }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockRejectedValue(
      new Error("database not found"),
    );

    await expect(
      campaignExport({ campaignId: 42, cdpPort: 9222, format: "json" }),
    ).rejects.toThrow("database not found");
  });

  it("propagates CampaignRepository errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(
      async (_accountId, callback) =>
        callback({ db: {} } as unknown as DatabaseContext),
    );
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getCampaign: vi.fn().mockImplementation(() => {
          throw new Error("campaign not found");
        }),
        getCampaignActions: vi.fn(),
      } as unknown as CampaignRepository;
    });

    await expect(
      campaignExport({ campaignId: 42, cdpPort: 9222, format: "json" }),
    ).rejects.toThrow("campaign not found");
  });

  it("propagates serialization errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(
      async (_accountId, callback) =>
        callback({ db: {} } as unknown as DatabaseContext),
    );
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getCampaign: vi.fn().mockReturnValue(MOCK_CAMPAIGN),
        getCampaignActions: vi.fn().mockReturnValue(MOCK_ACTIONS),
      } as unknown as CampaignRepository;
    });
    vi.mocked(serializeCampaignJson).mockImplementation(() => {
      throw new Error("serialization failed");
    });

    await expect(
      campaignExport({ campaignId: 42, cdpPort: 9222, format: "json" }),
    ).rejects.toThrow("serialization failed");
  });
});
