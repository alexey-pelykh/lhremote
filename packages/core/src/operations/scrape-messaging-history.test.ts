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
  MessageRepository: vi.fn(),
  ProfileRepository: vi.fn(),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import type { InstanceDatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CampaignService } from "../services/campaign.js";
import { MessageRepository, ProfileRepository } from "../db/index.js";
import { scrapeMessagingHistory } from "./scrape-messaging-history.js";

const MOCK_STATS = {
  totalMessages: 150,
  totalChats: 10,
  earliestMessage: "2025-01-01T00:00:00Z",
  latestMessage: "2026-01-15T00:00:00Z",
};

const MOCK_PROFILES = [
  { id: 100, externalIds: [{ typeGroup: "public", externalId: "john-doe" }] },
  { id: 200, externalIds: [{ typeGroup: "public", externalId: "jane-doe" }] },
];

const mockCampaignService = {
  create: vi.fn().mockResolvedValue({ id: 42 }),
  importPeopleFromUrls: vi.fn().mockResolvedValue({
    actionId: 1,
    successful: 2,
    alreadyInQueue: 0,
    alreadyProcessed: 0,
    failed: 0,
  }),
  start: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn().mockResolvedValue({
    runnerState: "idle",
    actionCounts: [{ queued: 0, processed: 0, successful: 2, failed: 0 }],
  }),
  pauseAll: vi.fn().mockResolvedValue([]),
  stopRunnerAndWaitForIdle: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  hardDelete: vi.fn(),
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
    return mockCampaignService as unknown as CampaignService;
  });

  vi.mocked(ProfileRepository).mockImplementation(function () {
    return {
      findByIds: vi.fn().mockReturnValue(MOCK_PROFILES),
    } as unknown as ProfileRepository;
  });

  vi.mocked(MessageRepository).mockImplementation(function () {
    return {
      getMessageStats: vi.fn().mockReturnValue(MOCK_STATS),
    } as unknown as MessageRepository;
  });
}

describe("scrapeMessagingHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when personIds is empty", async () => {
    await expect(
      scrapeMessagingHistory({ personIds: [], cdpPort: 9222 }),
    ).rejects.toThrow("At least one personId is required");
  });

  it("returns success with stats after scraping", async () => {
    setupMocks();

    const result = await scrapeMessagingHistory({
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.actionType).toBe("ScrapeMessagingHistory");
    expect(result.stats).toBe(MOCK_STATS);
  });

  it("creates ephemeral campaign with ScrapeMessagingHistory action", async () => {
    setupMocks();

    await scrapeMessagingHistory({
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(mockCampaignService.create).toHaveBeenCalledWith({
      name: expect.stringContaining("[ephemeral] ScrapeMessagingHistory"),
      actions: [{
        name: "ScrapeMessagingHistory",
        actionType: "ScrapeMessagingHistory",
        coolDown: 0,
        maxActionResultsPerIteration: 2,
      }],
    });
  });

  it("resolves personIds to LinkedIn URLs and imports them", async () => {
    setupMocks();

    await scrapeMessagingHistory({
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(mockCampaignService.importPeopleFromUrls).toHaveBeenCalledWith(
      42,
      [
        "https://www.linkedin.com/in/john-doe",
        "https://www.linkedin.com/in/jane-doe",
      ],
    );
  });

  it("starts campaign and polls for completion", async () => {
    setupMocks();

    await scrapeMessagingHistory({
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(mockCampaignService.start).toHaveBeenCalledWith(42, []);
    expect(mockCampaignService.getStatus).toHaveBeenCalledWith(42);
  });

  it("cleans up campaign after success", async () => {
    setupMocks();

    await scrapeMessagingHistory({
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(mockCampaignService.stopRunnerAndWaitForIdle).toHaveBeenCalled();
    expect(mockCampaignService.stop).toHaveBeenCalledWith(42);
    expect(mockCampaignService.hardDelete).toHaveBeenCalledWith(42);
  });

  it("cleans up campaign after failure", async () => {
    setupMocks();
    mockCampaignService.start.mockRejectedValueOnce(new Error("start failed"));

    await expect(
      scrapeMessagingHistory({ personIds: [100, 200], cdpPort: 9222 }),
    ).rejects.toThrow("start failed");

    expect(mockCampaignService.stopRunnerAndWaitForIdle).toHaveBeenCalled();
    expect(mockCampaignService.stop).toHaveBeenCalledWith(42);
    expect(mockCampaignService.hardDelete).toHaveBeenCalledWith(42);
  });

  it("throws when person not found in database", async () => {
    setupMocks();
    vi.mocked(ProfileRepository).mockImplementation(function () {
      return {
        findByIds: vi.fn().mockReturnValue([null]),
      } as unknown as ProfileRepository;
    });

    await expect(
      scrapeMessagingHistory({ personIds: [999], cdpPort: 9222 }),
    ).rejects.toThrow("Person 999 not found in database");
  });

  it("throws when person has no LinkedIn public ID", async () => {
    setupMocks();
    vi.mocked(ProfileRepository).mockImplementation(function () {
      return {
        findByIds: vi.fn().mockReturnValue([{ id: 100, externalIds: [] }]),
      } as unknown as ProfileRepository;
    });

    await expect(
      scrapeMessagingHistory({ personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("Person 100 has no LinkedIn public ID");
  });

  it("passes instanceTimeout to withInstanceDatabase", async () => {
    setupMocks();

    await scrapeMessagingHistory({
      personIds: [100],
      cdpPort: 9222,
    });

    expect(withInstanceDatabase).toHaveBeenCalledWith(
      9222,
      1,
      expect.any(Function),
      { instanceTimeout: 300_000, db: { readOnly: false } },
    );
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await scrapeMessagingHistory({
      personIds: [100],
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

    await scrapeMessagingHistory({
      personIds: [100],
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      scrapeMessagingHistory({ personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withInstanceDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new Error("instance not running"),
    );

    await expect(
      scrapeMessagingHistory({ personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("instance not running");
  });

  it("propagates MessageRepository errors", async () => {
    setupMocks();
    vi.mocked(MessageRepository).mockImplementation(function () {
      return {
        getMessageStats: vi.fn().mockImplementation(() => {
          throw new Error("query failed");
        }),
      } as unknown as MessageRepository;
    });

    await expect(
      scrapeMessagingHistory({ personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("query failed");
  });
});
