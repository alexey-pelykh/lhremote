// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Campaign,
  CampaignAction,
  CampaignActionResult,
  Profile,
} from "../types/index.js";
import {
  CampaignExecutionError,
  CampaignTimeoutError,
} from "./errors.js";
import { EphemeralCampaignService } from "./ephemeral-campaign.js";

// Mock InstanceService
const mockEvaluateUI = vi.fn();

vi.mock("./instance.js", () => ({
  InstanceService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.evaluateUI = mockEvaluateUI;
  }),
}));

// Mock CampaignRepository (via db/index.js)
const mockListCampaigns = vi.fn();
const mockGetCampaign = vi.fn();
const mockGetCampaignActions = vi.fn();
const mockGetResults = vi.fn();
const mockFixIsValid = vi.fn();
const mockCreateActionExcludeLists = vi.fn();
const mockDeleteCampaign = vi.fn();

// Mock CampaignStatisticsRepository
const mockResetForRerun = vi.fn();

// Mock ProfileRepository
const mockFindByIds = vi.fn();
const mockFindByPublicId = vi.fn();

vi.mock("../db/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/index.js")>();
  return {
    CampaignRepository: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.listCampaigns = mockListCampaigns;
      this.getCampaign = mockGetCampaign;
      this.getCampaignActions = mockGetCampaignActions;
      this.getResults = mockGetResults;
      this.fixIsValid = mockFixIsValid;
      this.createActionExcludeLists = mockCreateActionExcludeLists;
      this.deleteCampaign = mockDeleteCampaign;
    }),
    CampaignStatisticsRepository: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.resetForRerun = mockResetForRerun;
    }),
    ProfileRepository: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.findByIds = mockFindByIds;
      this.findByPublicId = mockFindByPublicId;
    }),
    CampaignNotFoundError: original.CampaignNotFoundError,
    ActionNotFoundError: original.ActionNotFoundError,
    ProfileNotFoundError: original.ProfileNotFoundError,
  };
});

import { InstanceService } from "./instance.js";

const MOCK_CAMPAIGN: Campaign = {
  id: 99,
  name: "[ephemeral] MessageToPerson",
  description: null,
  state: "paused",
  liAccountId: 1,
  isPaused: true,
  isArchived: false,
  isValid: true,
  createdAt: "2025-01-15T00:00:00Z",
};

const MOCK_ACTIONS: CampaignAction[] = [
  {
    id: 10,
    campaignId: 99,
    name: "MessageToPerson",
    description: null,
    config: {
      id: 100,
      actionType: "MessageToPerson",
      actionSettings: { message: "Hello" },
      coolDown: 0,
      maxActionResultsPerIteration: 1,
      isDraft: false,
    },
    versionId: 1000,
  },
];

const MOCK_PROFILE: Profile = {
  id: 42,
  miniProfile: { firstName: "Ada", lastName: "Lovelace", headline: "Engineer", avatar: null },
  externalIds: [
    { externalId: "ada-lovelace", typeGroup: "public", isMemberId: false },
    { externalId: "123456789", typeGroup: "member", isMemberId: true },
  ],
  currentPosition: null,
  education: [],
  skills: [],
  emails: [],
};

const MOCK_RESULT: CampaignActionResult = {
  id: 1,
  actionVersionId: 1000,
  personId: 42,
  result: 1,
  platform: "LINKEDIN",
  createdAt: "2025-01-15T12:00:00Z",
  profile: { firstName: "Ada", lastName: "Lovelace", headline: "Engineer", company: null, title: null },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EphemeralCampaignService", () => {
  let service: EphemeralCampaignService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockEvaluateUI.mockResolvedValue(undefined);

    const instance = new InstanceService(9223);
    service = new EphemeralCampaignService(instance, {} as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Set up mocks for a successful execute() flow:
   *   create → import → start (idle + unpause + runner) → poll (status) → results → stop → cleanup
   */
  function setupSuccessFlow(): void {
    // create: CDP createCampaign returns campaign ID
    mockEvaluateUI.mockResolvedValueOnce({ id: 99 });
    mockGetCampaign.mockReturnValue(MOCK_CAMPAIGN);
    mockGetCampaignActions.mockReturnValue(MOCK_ACTIONS);

    // import: CDP importPeopleFromUrls
    mockEvaluateUI.mockResolvedValueOnce({
      total: { addToTarget: { successful: 1, alreadyInQueue: 0, alreadyProcessed: 0, failed: 0 } },
    });

    // start: waitForIdle (idle), unpause, start runner
    mockEvaluateUI
      .mockResolvedValueOnce("idle")    // getRunnerState
      .mockResolvedValueOnce(undefined) // unpause
      .mockResolvedValueOnce(true);     // start

    // poll: getStatus (campaign + actions + runnerState + isPaused + actionCounts)
    mockEvaluateUI
      .mockResolvedValueOnce("idle")   // runnerState
      .mockResolvedValueOnce(false)    // isPaused
      .mockResolvedValueOnce({ queued: 0, processed: 0, successful: 1, failed: 0 }); // actionCounts

    // results
    mockGetResults.mockReturnValue([MOCK_RESULT]);

    // stop: pause + stop runner
    mockEvaluateUI
      .mockResolvedValueOnce(undefined) // pause
      .mockResolvedValueOnce(undefined); // stop runner

    // hardDelete is sync (db only)
  }

  describe("execute with person ID target", () => {
    it("executes full lifecycle: create → import → start → poll → results → cleanup", async () => {
      mockFindByIds.mockReturnValue([MOCK_PROFILE]);
      setupSuccessFlow();

      const promise = service.execute("MessageToPerson", 42, { message: "Hello" });
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.personId).toBe(42);
      expect(result.results).toEqual([MOCK_RESULT]);
      expect(result.campaignId).toBeUndefined();
    });

    it("resolves LinkedIn URL from person profile", async () => {
      mockFindByIds.mockReturnValue([MOCK_PROFILE]);
      setupSuccessFlow();

      const promise = service.execute("MessageToPerson", 42);
      await vi.advanceTimersByTimeAsync(10_000);
      await promise;

      // import call should include the resolved LinkedIn URL
      const importExpr = mockEvaluateUI.mock.calls[1]?.[0] as string;
      expect(importExpr).toContain("ada-lovelace");
    });

    it("throws CampaignExecutionError when person ID not found", async () => {
      mockFindByIds.mockReturnValue([null]);

      await expect(
        service.execute("MessageToPerson", 999),
      ).rejects.toThrow(CampaignExecutionError);
    });

    it("throws CampaignExecutionError when person has no public ID", async () => {
      mockFindByIds.mockReturnValue([{
        ...MOCK_PROFILE,
        externalIds: [{ externalId: "123", typeGroup: "member", isMemberId: true }],
      }]);

      await expect(
        service.execute("MessageToPerson", 42),
      ).rejects.toThrow(CampaignExecutionError);
    });
  });

  describe("execute with LinkedIn URL target", () => {
    it("imports from URL and resolves person ID after import", async () => {
      mockFindByPublicId.mockReturnValue(MOCK_PROFILE);
      setupSuccessFlow();

      const promise = service.execute(
        "InvitePerson",
        "https://www.linkedin.com/in/ada-lovelace",
      );
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.personId).toBe(42);
      expect(mockFindByPublicId).toHaveBeenCalledWith("ada-lovelace");
    });

    it("throws CampaignExecutionError for invalid LinkedIn URL", async () => {
      await expect(
        service.execute("InvitePerson", "https://example.com/not-linkedin"),
      ).rejects.toThrow(CampaignExecutionError);
    });
  });

  describe("import failure", () => {
    it("throws CampaignExecutionError when import fails and cleans up", async () => {
      mockFindByIds.mockReturnValue([MOCK_PROFILE]);

      // create succeeds
      mockEvaluateUI.mockResolvedValueOnce({ id: 99 });
      mockGetCampaign.mockReturnValue(MOCK_CAMPAIGN);
      mockGetCampaignActions.mockReturnValue(MOCK_ACTIONS);

      // import returns zero successful
      mockEvaluateUI.mockResolvedValueOnce({
        total: { addToTarget: { successful: 0, alreadyInQueue: 0, alreadyProcessed: 0, failed: 1 } },
      });

      await expect(
        service.execute("MessageToPerson", 42),
      ).rejects.toThrow(CampaignExecutionError);

      // Verify cleanup happened (hardDelete is sync)
      expect(mockDeleteCampaign).toHaveBeenCalledWith(99);
    });
  });

  describe("timeout handling", () => {
    it("throws CampaignTimeoutError when action does not complete", async () => {
      mockFindByIds.mockReturnValue([MOCK_PROFILE]);

      // create
      mockEvaluateUI.mockResolvedValueOnce({ id: 99 });
      mockGetCampaign.mockReturnValue(MOCK_CAMPAIGN);
      mockGetCampaignActions.mockReturnValue(MOCK_ACTIONS);

      // import
      mockEvaluateUI.mockResolvedValueOnce({
        total: { addToTarget: { successful: 1, alreadyInQueue: 0, alreadyProcessed: 0, failed: 0 } },
      });

      // start
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(true);

      // poll: always shows queued (never completes)
      mockEvaluateUI
        .mockResolvedValue("campaigns"); // runnerState stays "campaigns" for subsequent calls

      const promise = service.execute("MessageToPerson", 42, undefined, { timeout: 5_000 });
      const caughtPromise = promise.catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(10_000);
      const error = await caughtPromise;

      expect(error).toBeInstanceOf(CampaignTimeoutError);
    });
  });

  describe("keepCampaign option", () => {
    it("archives instead of hard-deleting when keepCampaign is true", async () => {
      mockFindByIds.mockReturnValue([MOCK_PROFILE]);
      setupSuccessFlow();

      const promise = service.execute("MessageToPerson", 42, undefined, { keepCampaign: true });
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await promise;

      expect(result.campaignId).toBe(99);
      // Should NOT hard-delete
      expect(mockDeleteCampaign).not.toHaveBeenCalled();
      // Archive is done via CDP (setCampaignArchivedStatus) — verify the call
      const archiveCall = mockEvaluateUI.mock.calls.find(
        (call) => (call[0] as string).includes("setCampaignArchivedStatus"),
      );
      expect(archiveCall).toBeDefined();
    });
  });

  describe("failed action result", () => {
    it("returns success=false when action result is negative", async () => {
      mockFindByIds.mockReturnValue([MOCK_PROFILE]);

      // create
      mockEvaluateUI.mockResolvedValueOnce({ id: 99 });
      mockGetCampaign.mockReturnValue(MOCK_CAMPAIGN);
      mockGetCampaignActions.mockReturnValue(MOCK_ACTIONS);

      // import
      mockEvaluateUI.mockResolvedValueOnce({
        total: { addToTarget: { successful: 1, alreadyInQueue: 0, alreadyProcessed: 0, failed: 0 } },
      });

      // start
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(true);

      // poll: action failed
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce({ queued: 0, processed: 0, successful: 0, failed: 1 });

      // results
      const failedResult = { ...MOCK_RESULT, result: -1 };
      mockGetResults.mockReturnValue([failedResult]);

      // stop
      mockEvaluateUI
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const promise = service.execute("MessageToPerson", 42);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.results[0]?.result).toBe(-1);
    });
  });

  describe("runner idle with no queued", () => {
    it("completes when runner returns to idle with zero queued", async () => {
      mockFindByIds.mockReturnValue([MOCK_PROFILE]);

      // create
      mockEvaluateUI.mockResolvedValueOnce({ id: 99 });
      mockGetCampaign.mockReturnValue(MOCK_CAMPAIGN);
      mockGetCampaignActions.mockReturnValue(MOCK_ACTIONS);

      // import
      mockEvaluateUI.mockResolvedValueOnce({
        total: { addToTarget: { successful: 1, alreadyInQueue: 0, alreadyProcessed: 0, failed: 0 } },
      });

      // start
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(true);

      // poll: idle with zero queued but zero successful/failed (edge case)
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce({ queued: 0, processed: 0, successful: 0, failed: 0 });

      // results (empty — person was processed but no result recorded)
      mockGetResults.mockReturnValue([]);

      // stop
      mockEvaluateUI
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const promise = service.execute("MessageToPerson", 42);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.results).toEqual([]);
    });
  });
});
