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
import { checkReplies } from "./check-replies.js";

const MOCK_CONVERSATIONS = [
  {
    chatId: 5,
    personId: 100,
    personName: "Alice",
    messages: [
      { id: 1, type: "text", text: "hello", subject: null, sendAt: "2026-01-01T00:00:00Z", attachmentsCount: 0, senderPersonId: 100, senderFirstName: "Alice", senderLastName: null },
      { id: 2, type: "text", text: "how are you?", subject: null, sendAt: "2026-01-01T00:01:00Z", attachmentsCount: 0, senderPersonId: 100, senderFirstName: "Alice", senderLastName: null },
    ],
  },
];

const MOCK_PROFILES = [
  { id: 100, externalIds: [{ typeGroup: "public", externalId: "alice-wonder" }] },
  { id: 200, externalIds: [{ typeGroup: "public", externalId: "bob-builder" }] },
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
      getMessagesSince: vi.fn().mockReturnValue(MOCK_CONVERSATIONS),
    } as unknown as MessageRepository;
  });
}

describe("checkReplies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when personIds is empty", async () => {
    await expect(
      checkReplies({ personIds: [], cdpPort: 9222 }),
    ).rejects.toThrow("At least one personId is required");
  });

  it("returns new messages and totals", async () => {
    setupMocks();

    const result = await checkReplies({
      personIds: [100, 200],
      cdpPort: 9222,
      since: "2025-12-31T00:00:00Z",
    });

    expect(result.newMessages).toEqual(MOCK_CONVERSATIONS);
    expect(result.totalNew).toBe(2);
    expect(result.checkedAt).toBeDefined();
  });

  it("filters messages to only requested personIds", async () => {
    setupMocks();
    vi.mocked(MessageRepository).mockImplementation(function () {
      return {
        getMessagesSince: vi.fn().mockReturnValue([
          ...MOCK_CONVERSATIONS,
          {
            chatId: 10,
            personId: 999,
            personName: "Unrelated",
            messages: [
              { id: 3, type: "text", text: "unrelated", subject: null, sendAt: "2026-01-01T00:02:00Z", attachmentsCount: 0, senderPersonId: 999, senderFirstName: "Unrelated", senderLastName: null },
            ],
          },
        ]),
      } as unknown as MessageRepository;
    });

    const result = await checkReplies({
      personIds: [100],
      cdpPort: 9222,
    });

    expect(result.newMessages).toHaveLength(1);
    expect(result.newMessages[0]?.personId).toBe(100);
    expect(result.totalNew).toBe(2);
  });

  it("creates ephemeral campaign with CheckForReplies action and settings", async () => {
    setupMocks();

    await checkReplies({
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(mockCampaignService.create).toHaveBeenCalledWith({
      name: expect.stringContaining("[ephemeral] CheckForReplies"),
      actions: [{
        name: "CheckForReplies",
        actionType: "CheckForReplies",
        coolDown: 0,
        maxActionResultsPerIteration: 2,
        actionSettings: {
          moveToSuccessfulAfterMs: 86_400_000,
          treatMessageAcceptedAsReply: false,
          keepInQueueIfRequestIsNotAccepted: true,
        },
      }],
    });
  });

  it("resolves personIds to LinkedIn URLs and imports them", async () => {
    setupMocks();

    await checkReplies({
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(mockCampaignService.importPeopleFromUrls).toHaveBeenCalledWith(
      42,
      [
        "https://www.linkedin.com/in/alice-wonder",
        "https://www.linkedin.com/in/bob-builder",
      ],
    );
  });

  it("starts campaign and polls for completion", async () => {
    setupMocks();

    await checkReplies({
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(mockCampaignService.start).toHaveBeenCalledWith(42, []);
    expect(mockCampaignService.getStatus).toHaveBeenCalledWith(42);
  });

  it("cleans up campaign after success", async () => {
    setupMocks();

    await checkReplies({
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(mockCampaignService.stop).toHaveBeenCalledWith(42);
    expect(mockCampaignService.hardDelete).toHaveBeenCalledWith(42);
  });

  it("cleans up campaign after failure", async () => {
    setupMocks();
    mockCampaignService.start.mockRejectedValueOnce(new Error("start failed"));

    await expect(
      checkReplies({ personIds: [100, 200], cdpPort: 9222 }),
    ).rejects.toThrow("start failed");

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
      checkReplies({ personIds: [999], cdpPort: 9222 }),
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
      checkReplies({ personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("Person 100 has no LinkedIn public ID");
  });

  it("passes instanceTimeout and db readOnly: false to withInstanceDatabase", async () => {
    setupMocks();

    await checkReplies({
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

    await checkReplies({
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

    await checkReplies({
      personIds: [100],
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      checkReplies({ personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withInstanceDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new Error("instance not running"),
    );

    await expect(
      checkReplies({ personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("instance not running");
  });

  it("propagates MessageRepository errors", async () => {
    setupMocks();
    vi.mocked(MessageRepository).mockImplementation(function () {
      return {
        getMessagesSince: vi.fn().mockImplementation(() => {
          throw new Error("query failed");
        }),
      } as unknown as MessageRepository;
    });

    await expect(
      checkReplies({ personIds: [100], cdpPort: 9222 }),
    ).rejects.toThrow("query failed");
  });
});
