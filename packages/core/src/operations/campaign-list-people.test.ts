// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

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

import type { DatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignRepository } from "../db/index.js";
import { campaignListPeople } from "./campaign-list-people.js";

const MOCK_PEOPLE = {
  people: [
    {
      personId: 100,
      firstName: "Alice",
      lastName: "Smith",
      publicId: "alice-smith",
      status: "queued" as const,
      currentActionId: 1,
    },
    {
      personId: 200,
      firstName: "Bob",
      lastName: null,
      publicId: null,
      status: "successful" as const,
      currentActionId: 2,
    },
  ],
  total: 2,
};

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      listPeople: vi.fn().mockReturnValue(MOCK_PEOPLE),
    } as unknown as CampaignRepository;
  });
}

describe("campaignListPeople", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns people for a campaign", async () => {
    setupMocks();

    const result = await campaignListPeople({
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(result.campaignId).toBe(42);
    expect(result.people).toHaveLength(2);
    expect(result.people[0]?.personId).toBe(100);
    expect(result.people[1]?.personId).toBe(200);
    expect(result.total).toBe(2);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it("passes actionId, status, limit, and offset to repository", async () => {
    setupMocks();

    await campaignListPeople({
      campaignId: 42,
      cdpPort: 9222,
      actionId: 5,
      status: "queued",
      limit: 10,
      offset: 20,
    });

    const mockResult = vi.mocked(CampaignRepository).mock.results[0] as {
      value: InstanceType<typeof CampaignRepository>;
    };
    expect(mockResult.value.listPeople).toHaveBeenCalledWith(42, {
      actionId: 5,
      status: "queued",
      limit: 10,
      offset: 20,
    });
  });

  it("uses default limit and offset when not provided", async () => {
    setupMocks();

    await campaignListPeople({
      campaignId: 42,
      cdpPort: 9222,
    });

    const mockResult = vi.mocked(CampaignRepository).mock.results[0] as {
      value: InstanceType<typeof CampaignRepository>;
    };
    expect(mockResult.value.listPeople).toHaveBeenCalledWith(42, {
      limit: 20,
      offset: 0,
    });
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await campaignListPeople({
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

    await campaignListPeople({
      campaignId: 42,
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(
      new Error("connection refused"),
    );

    await expect(
      campaignListPeople({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockRejectedValue(
      new Error("database not found"),
    );

    await expect(
      campaignListPeople({ campaignId: 42, cdpPort: 9222 }),
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
        listPeople: vi.fn().mockImplementation(() => {
          throw new Error("repository error");
        }),
      } as unknown as CampaignRepository;
    });

    await expect(
      campaignListPeople({ campaignId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("repository error");
  });
});
