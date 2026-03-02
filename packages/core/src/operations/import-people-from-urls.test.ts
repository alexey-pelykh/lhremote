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
import { IMPORT_CHUNK_SIZE, importPeopleFromUrls } from "./import-people-from-urls.js";

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

  it("returns import results with totalUrls", async () => {
    setupMocks();

    const result = await importPeopleFromUrls({
      campaignId: 42,
      linkedInUrls: ["https://linkedin.com/in/alice", "https://linkedin.com/in/bob"],
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.campaignId).toBe(42);
    expect(result.actionId).toBe(1);
    expect(result.totalUrls).toBe(2);
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

  it("sends all URLs in one call when under chunk size", async () => {
    const mockImport = vi.fn().mockResolvedValue(MOCK_IMPORT_RESULT);
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
      return { importPeopleFromUrls: mockImport } as unknown as CampaignService;
    });

    const urls = Array.from({ length: 50 }, (_, i) => `https://linkedin.com/in/user-${String(i)}`);
    await importPeopleFromUrls({ campaignId: 42, linkedInUrls: urls, cdpPort: 9222 });

    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(mockImport).toHaveBeenCalledWith(42, urls);
  });

  it("chunks URLs exceeding IMPORT_CHUNK_SIZE into multiple calls", async () => {
    const mockImport = vi.fn().mockResolvedValue({
      actionId: 1,
      successful: 100,
      alreadyInQueue: 0,
      alreadyProcessed: 0,
      failed: 0,
    });
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
      return { importPeopleFromUrls: mockImport } as unknown as CampaignService;
    });

    const totalUrls = IMPORT_CHUNK_SIZE + 50;
    const urls = Array.from({ length: totalUrls }, (_, i) => `https://linkedin.com/in/user-${String(i)}`);
    await importPeopleFromUrls({ campaignId: 42, linkedInUrls: urls, cdpPort: 9222 });

    expect(mockImport).toHaveBeenCalledTimes(2);
    expect(mockImport).toHaveBeenNthCalledWith(1, 42, urls.slice(0, IMPORT_CHUNK_SIZE));
    expect(mockImport).toHaveBeenNthCalledWith(2, 42, urls.slice(IMPORT_CHUNK_SIZE));
  });

  it("aggregates results across chunks", async () => {
    const mockImport = vi.fn()
      .mockResolvedValueOnce({
        actionId: 1,
        successful: 150,
        alreadyInQueue: 30,
        alreadyProcessed: 15,
        failed: 5,
      })
      .mockResolvedValueOnce({
        actionId: 1,
        successful: 40,
        alreadyInQueue: 5,
        alreadyProcessed: 3,
        failed: 2,
      });
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
      return { importPeopleFromUrls: mockImport } as unknown as CampaignService;
    });

    const totalUrls = IMPORT_CHUNK_SIZE + 50;
    const urls = Array.from({ length: totalUrls }, (_, i) => `https://linkedin.com/in/user-${String(i)}`);
    const result = await importPeopleFromUrls({ campaignId: 42, linkedInUrls: urls, cdpPort: 9222 });

    expect(result).toEqual({
      success: true,
      campaignId: 42,
      actionId: 1,
      totalUrls,
      imported: 190,
      alreadyInQueue: 35,
      alreadyProcessed: 18,
      failed: 7,
    });
  });
});
