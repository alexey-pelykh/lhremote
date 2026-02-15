// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withInstanceDatabase: vi.fn(),
}));

vi.mock("../services/campaign.js", () => ({
  CampaignService: vi.fn(),
}));

import type { InstanceDatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CampaignService } from "../services/campaign.js";
import { importPeopleFromUrls } from "./import-people-from-urls.js";

const MOCK_IMPORT_RESULT = {
  actionId: 1,
  successful: 3,
  alreadyInQueue: 1,
  alreadyProcessed: 0,
  failed: 0,
};

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withInstanceDatabase).mockImplementation(
    async (_cdpPort, _accountId, callback) =>
      callback({
        accountId: 1,
        instance: {},
        db: {},
      } as unknown as InstanceDatabaseContext),
  );

  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      importPeopleFromUrls: vi.fn().mockResolvedValue(MOCK_IMPORT_RESULT),
    } as unknown as CampaignService;
  });
}

describe("importPeopleFromUrls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns import results", async () => {
    setupMocks();

    const result = await importPeopleFromUrls({
      campaignId: 42,
      linkedInUrls: ["https://linkedin.com/in/alice", "https://linkedin.com/in/bob"],
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.campaignId).toBe(42);
    expect(result.actionId).toBe(1);
    expect(result.imported).toBe(3);
    expect(result.alreadyInQueue).toBe(1);
    expect(result.alreadyProcessed).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await importPeopleFromUrls({
      campaignId: 42,
      linkedInUrls: ["https://linkedin.com/in/alice"],
      cdpPort: 1234,
      cdpHost: "192.168.1.1",
      allowRemote: true,
    });

    expect(resolveAccount).toHaveBeenCalledWith(1234, {
      host: "192.168.1.1",
      allowRemote: true,
    });
  });

  it("omits undefined connection options", async () => {
    setupMocks();

    await importPeopleFromUrls({
      campaignId: 42,
      linkedInUrls: ["https://linkedin.com/in/alice"],
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      importPeopleFromUrls({
        campaignId: 42,
        linkedInUrls: ["https://linkedin.com/in/alice"],
        cdpPort: 9222,
      }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withInstanceDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new Error("instance not running"),
    );

    await expect(
      importPeopleFromUrls({
        campaignId: 42,
        linkedInUrls: ["https://linkedin.com/in/alice"],
        cdpPort: 9222,
      }),
    ).rejects.toThrow("instance not running");
  });

  it("propagates CampaignService errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: {},
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        importPeopleFromUrls: vi.fn().mockRejectedValue(new Error("campaign not found")),
      } as unknown as CampaignService;
    });

    await expect(
      importPeopleFromUrls({
        campaignId: 42,
        linkedInUrls: ["https://linkedin.com/in/alice"],
        cdpPort: 9222,
      }),
    ).rejects.toThrow("campaign not found");
  });
});
