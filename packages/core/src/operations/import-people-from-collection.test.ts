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

vi.mock("../db/index.js", () => ({
  CollectionListRepository: vi.fn(),
}));

import type { InstanceDatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CampaignService } from "../services/campaign.js";
import { CollectionListRepository } from "../db/index.js";
import { importPeopleFromCollection } from "./import-people-from-collection.js";

const MOCK_URLS = [
  "https://www.linkedin.com/in/ada-lovelace-test/",
  "https://www.linkedin.com/in/charlie-babbage-test/",
];

const MOCK_IMPORT_RESULT = {
  actionId: 1,
  successful: 2,
  alreadyInQueue: 0,
  alreadyProcessed: 0,
  failed: 0,
};

function setupMocks(urls: string[] = MOCK_URLS) {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withInstanceDatabase).mockImplementation(
    async (_cdpPort, _accountId, callback) =>
      callback({
        accountId: 1,
        instance: {},
        db: {},
      } as unknown as InstanceDatabaseContext),
  );

  vi.mocked(CollectionListRepository).mockImplementation(function () {
    return {
      getCollectionPeopleUrls: vi.fn().mockReturnValue(urls),
    } as unknown as CollectionListRepository;
  });

  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      importPeopleFromUrls: vi.fn().mockResolvedValue(MOCK_IMPORT_RESULT),
    } as unknown as CampaignService;
  });
}

describe("importPeopleFromCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns import results", async () => {
    setupMocks();

    const result = await importPeopleFromCollection({
      collectionId: 10,
      campaignId: 1,
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.collectionId).toBe(10);
    expect(result.campaignId).toBe(1);
    expect(result.actionId).toBe(1);
    expect(result.totalUrls).toBe(2);
    expect(result.imported).toBe(2);
  });

  it("returns zero results for empty collection", async () => {
    setupMocks([]);

    const result = await importPeopleFromCollection({
      collectionId: 12,
      campaignId: 1,
      cdpPort: 9222,
    });

    expect(result.totalUrls).toBe(0);
    expect(result.imported).toBe(0);
    expect(result.actionId).toBe(0);
  });

  it("does not call campaignService for empty collection", async () => {
    setupMocks([]);

    await importPeopleFromCollection({
      collectionId: 12,
      campaignId: 1,
      cdpPort: 9222,
    });

    // CampaignService should not be instantiated
    expect(CampaignService).not.toHaveBeenCalled();
  });

  it("passes URLs from collection to campaignService", async () => {
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
    vi.mocked(CollectionListRepository).mockImplementation(function () {
      return {
        getCollectionPeopleUrls: vi.fn().mockReturnValue(MOCK_URLS),
      } as unknown as CollectionListRepository;
    });
    vi.mocked(CampaignService).mockImplementation(function () {
      return { importPeopleFromUrls: mockImport } as unknown as CampaignService;
    });

    await importPeopleFromCollection({
      collectionId: 10,
      campaignId: 1,
      cdpPort: 9222,
    });

    expect(mockImport).toHaveBeenCalledWith(1, MOCK_URLS);
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await importPeopleFromCollection({
      collectionId: 10,
      campaignId: 1,
      cdpPort: 1234,
      cdpHost: "192.168.1.1",
      allowRemote: true,
    });

    expect(resolveAccount).toHaveBeenCalledWith(1234, {
      host: "192.168.1.1",
      allowRemote: true,
    });
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      importPeopleFromCollection({
        collectionId: 10,
        campaignId: 1,
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
      importPeopleFromCollection({
        collectionId: 10,
        campaignId: 1,
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
    vi.mocked(CollectionListRepository).mockImplementation(function () {
      return {
        getCollectionPeopleUrls: vi.fn().mockReturnValue(MOCK_URLS),
      } as unknown as CollectionListRepository;
    });
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        importPeopleFromUrls: vi.fn().mockRejectedValue(new Error("campaign not found")),
      } as unknown as CampaignService;
    });

    await expect(
      importPeopleFromCollection({
        collectionId: 10,
        campaignId: 42,
        cdpPort: 9222,
      }),
    ).rejects.toThrow("campaign not found");
  });
});
