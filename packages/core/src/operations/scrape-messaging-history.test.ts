// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withInstanceDatabase: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  MessageRepository: vi.fn(),
}));

import type { InstanceDatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { MessageRepository } from "../db/index.js";
import { scrapeMessagingHistory } from "./scrape-messaging-history.js";

const MOCK_STATS = {
  totalMessages: 150,
  totalChats: 10,
  earliestMessage: "2025-01-01T00:00:00Z",
  latestMessage: "2026-01-15T00:00:00Z",
};

const mockInstance = { executeAction: vi.fn().mockResolvedValue(undefined) };

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withInstanceDatabase).mockImplementation(
    async (_cdpPort, _accountId, callback) =>
      callback({
        accountId: 1,
        instance: mockInstance,
        db: {},
      } as unknown as InstanceDatabaseContext),
  );

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

  it("returns success with stats after scraping", async () => {
    setupMocks();

    const result = await scrapeMessagingHistory({
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.actionType).toBe("ScrapeMessagingHistory");
    expect(result.stats).toBe(MOCK_STATS);
  });

  it("calls instance.executeAction with ScrapeMessagingHistory", async () => {
    setupMocks();

    await scrapeMessagingHistory({
      cdpPort: 9222,
    });

    expect(mockInstance.executeAction).toHaveBeenCalledWith("ScrapeMessagingHistory");
  });

  it("passes instanceTimeout to withInstanceDatabase", async () => {
    setupMocks();

    await scrapeMessagingHistory({
      cdpPort: 9222,
    });

    expect(withInstanceDatabase).toHaveBeenCalledWith(
      9222,
      1,
      expect.any(Function),
      { instanceTimeout: 300_000 },
    );
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await scrapeMessagingHistory({
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
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      scrapeMessagingHistory({ cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withInstanceDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new Error("instance not running"),
    );

    await expect(
      scrapeMessagingHistory({ cdpPort: 9222 }),
    ).rejects.toThrow("instance not running");
  });

  it("propagates MessageRepository errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: mockInstance,
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
    vi.mocked(MessageRepository).mockImplementation(function () {
      return {
        getMessageStats: vi.fn().mockImplementation(() => {
          throw new Error("query failed");
        }),
      } as unknown as MessageRepository;
    });

    await expect(
      scrapeMessagingHistory({ cdpPort: 9222 }),
    ).rejects.toThrow("query failed");
  });
});
