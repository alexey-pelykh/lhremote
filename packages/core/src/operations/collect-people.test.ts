// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withInstanceDatabase: vi.fn(),
}));

vi.mock("../services/collection.js", () => ({
  CollectionService: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  CampaignRepository: vi.fn(),
}));

import type { InstanceDatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CollectionService } from "../services/collection.js";
import { CollectionError } from "../services/errors.js";
import { CampaignRepository } from "../db/index.js";
import { collectPeople } from "./collect-people.js";

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

  vi.mocked(CollectionService).mockImplementation(function () {
    return {
      collect: vi.fn().mockResolvedValue(undefined),
    } as unknown as CollectionService;
  });

  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      getCampaignActions: vi.fn().mockReturnValue([{ id: 10, campaignId: 42, name: "VisitAndExtract" }]),
    } as unknown as CampaignRepository;
  });
}

describe("collectPeople", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects source type from URL and returns result", async () => {
    setupMocks();

    const result = await collectPeople({
      sourceUrl: "https://www.linkedin.com/search/results/people/?keywords=test",
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      success: true,
      campaignId: 42,
      sourceType: "SearchPage",
    });
  });

  it("uses explicit sourceType when provided", async () => {
    setupMocks();

    const result = await collectPeople({
      sourceUrl: "https://www.linkedin.com/search/results/people/",
      campaignId: 42,
      sourceType: "MyConnections",
      cdpPort: 9222,
    });

    expect(result.sourceType).toBe("MyConnections");
  });

  it("throws CollectionError for invalid explicit sourceType", async () => {
    await expect(
      collectPeople({
        sourceUrl: "https://www.linkedin.com/search/results/people/",
        campaignId: 42,
        sourceType: "InvalidType",
        cdpPort: 9222,
      }),
    ).rejects.toThrow(CollectionError);
  });

  it("throws CollectionError for unrecognized URL without explicit sourceType", async () => {
    await expect(
      collectPeople({
        sourceUrl: "https://www.linkedin.com/some/unknown/page/",
        campaignId: 42,
        cdpPort: 9222,
      }),
    ).rejects.toThrow(CollectionError);
  });

  it("passes campaignId and actionId to CollectionService.collect", async () => {
    const mockCollect = vi.fn().mockResolvedValue(undefined);
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: {},
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
    vi.mocked(CollectionService).mockImplementation(function () {
      return { collect: mockCollect } as unknown as CollectionService;
    });
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getCampaignActions: vi.fn().mockReturnValue([{ id: 10, campaignId: 42, name: "VisitAndExtract" }]),
      } as unknown as CampaignRepository;
    });

    await collectPeople({
      sourceUrl: "https://www.linkedin.com/search/results/people/",
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(mockCollect).toHaveBeenCalledWith(
      "https://www.linkedin.com/search/results/people/",
      42,
      10,
    );
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await collectPeople({
      sourceUrl: "https://www.linkedin.com/search/results/people/",
      campaignId: 42,
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

    await collectPeople({
      sourceUrl: "https://www.linkedin.com/search/results/people/",
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      collectPeople({
        sourceUrl: "https://www.linkedin.com/search/results/people/",
        campaignId: 42,
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
      collectPeople({
        sourceUrl: "https://www.linkedin.com/search/results/people/",
        campaignId: 42,
        cdpPort: 9222,
      }),
    ).rejects.toThrow("instance not running");
  });

  it("propagates CollectionService errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: {},
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getCampaignActions: vi.fn().mockReturnValue([{ id: 10, campaignId: 42, name: "VisitAndExtract" }]),
      } as unknown as CampaignRepository;
    });
    vi.mocked(CollectionService).mockImplementation(function () {
      return {
        collect: vi.fn().mockRejectedValue(
          new CollectionError("instance is busy"),
        ),
      } as unknown as CollectionService;
    });

    await expect(
      collectPeople({
        sourceUrl: "https://www.linkedin.com/search/results/people/",
        campaignId: 42,
        cdpPort: 9222,
      }),
    ).rejects.toThrow("instance is busy");
  });
});
