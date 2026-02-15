// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Campaign,
  CampaignAction,
  CampaignActionResult,
  CampaignSummary,
} from "../types/index.js";
import {
  CampaignExecutionError,
  CampaignTimeoutError,
} from "./errors.js";
import { CampaignService } from "./campaign.js";

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
const mockAddAction = vi.fn();

// Mock CampaignStatisticsRepository (via db/index.js)
const mockResetForRerun = vi.fn();

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
      this.addAction = mockAddAction;
    }),
    CampaignStatisticsRepository: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.resetForRerun = mockResetForRerun;
    }),
    CampaignNotFoundError: original.CampaignNotFoundError,
    ActionNotFoundError: original.ActionNotFoundError,
  };
});

import { ActionNotFoundError, CampaignNotFoundError } from "../db/index.js";
import { InstanceService } from "./instance.js";

const MOCK_CAMPAIGN: Campaign = {
  id: 1,
  name: "Test Campaign",
  description: "Test description",
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
    campaignId: 1,
    name: "Visit & Extract",
    description: null,
    config: {
      id: 100,
      actionType: "VisitAndExtract",
      actionSettings: {},
      coolDown: 60000,
      maxActionResultsPerIteration: 10,
      isDraft: false,
    },
    versionId: 1000,
  },
];

const MOCK_SUMMARIES: CampaignSummary[] = [
  {
    id: 1,
    name: "Test Campaign",
    description: "Test description",
    state: "paused",
    liAccountId: 1,
    actionCount: 1,
    createdAt: "2025-01-15T00:00:00Z",
  },
];

const MOCK_RESULTS: CampaignActionResult[] = [
  {
    id: 1,
    actionVersionId: 1000,
    personId: 42,
    result: 1,
    platform: "LINKEDIN",
    createdAt: "2025-01-15T12:00:00Z",
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CampaignService", () => {
  let service: CampaignService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockEvaluateUI.mockResolvedValue(undefined);

    const instance = new InstanceService(9223);
    service = new CampaignService(instance, {} as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("create", () => {
    it("creates a campaign via CDP and returns it from DB", async () => {
      mockEvaluateUI.mockResolvedValueOnce({ id: 5 });
      mockGetCampaign.mockReturnValue({ ...MOCK_CAMPAIGN, id: 5 });

      const result = await service.create({
        name: "New Campaign",
        actions: [
          {
            name: "Visit",
            actionType: "VisitAndExtract",
          },
        ],
      });

      expect(result.id).toBe(5);
      expect(mockEvaluateUI).toHaveBeenCalledOnce();
      const cdpExpr = mockEvaluateUI.mock.calls[0]?.[0] as string;
      expect(cdpExpr).toContain("createCampaign");
      expect(cdpExpr).toContain("New Campaign");
      expect(cdpExpr).toContain("VisitAndExtract");
      expect(mockGetCampaign).toHaveBeenCalledWith(5);
    });

    it("uses default liAccountId of 1", async () => {
      mockEvaluateUI.mockResolvedValueOnce({ id: 5 });
      mockGetCampaign.mockReturnValue({ ...MOCK_CAMPAIGN, id: 5 });

      await service.create({
        name: "Test",
        actions: [{ name: "Visit", actionType: "VisitAndExtract" }],
      });

      const cdpExpr = mockEvaluateUI.mock.calls[0]?.[0] as string;
      expect(cdpExpr).toContain('"liAccount":1');
    });

    it("uses custom liAccountId when provided", async () => {
      mockEvaluateUI.mockResolvedValueOnce({ id: 5 });
      mockGetCampaign.mockReturnValue({ ...MOCK_CAMPAIGN, id: 5 });

      await service.create({
        name: "Test",
        liAccountId: 3,
        actions: [{ name: "Visit", actionType: "VisitAndExtract" }],
      });

      const cdpExpr = mockEvaluateUI.mock.calls[0]?.[0] as string;
      expect(cdpExpr).toContain('"liAccount":3');
    });

    it("applies default coolDown and maxActionResultsPerIteration", async () => {
      mockEvaluateUI.mockResolvedValueOnce({ id: 5 });
      mockGetCampaign.mockReturnValue({ ...MOCK_CAMPAIGN, id: 5 });

      await service.create({
        name: "Test",
        actions: [{ name: "Visit", actionType: "VisitAndExtract" }],
      });

      const cdpExpr = mockEvaluateUI.mock.calls[0]?.[0] as string;
      expect(cdpExpr).toContain('"coolDown":60000');
      expect(cdpExpr).toContain('"maxActionResultsPerIteration":10');
    });

    it("fixes is_valid after CDP creation", async () => {
      mockEvaluateUI.mockResolvedValueOnce({ id: 5 });
      mockGetCampaign.mockReturnValue({ ...MOCK_CAMPAIGN, id: 5 });

      await service.create({
        name: "New Campaign",
        actions: [{ name: "Visit", actionType: "VisitAndExtract" }],
      });

      expect(mockFixIsValid).toHaveBeenCalledWith(5);
      expect(mockFixIsValid).toHaveBeenCalledBefore(mockGetCampaign);
    });

    it("creates action-level exclude lists after CDP creation", async () => {
      mockEvaluateUI.mockResolvedValueOnce({ id: 5 });
      mockGetCampaign.mockReturnValue({ ...MOCK_CAMPAIGN, id: 5 });

      await service.create({
        name: "New Campaign",
        actions: [{ name: "Visit", actionType: "VisitAndExtract" }],
      });

      expect(mockCreateActionExcludeLists).toHaveBeenCalledWith(5, 1);
      expect(mockCreateActionExcludeLists).toHaveBeenCalledBefore(
        mockGetCampaign,
      );
    });

    it("uses custom liAccountId for action exclude lists", async () => {
      mockEvaluateUI.mockResolvedValueOnce({ id: 5 });
      mockGetCampaign.mockReturnValue({ ...MOCK_CAMPAIGN, id: 5 });

      await service.create({
        name: "Test",
        liAccountId: 3,
        actions: [{ name: "Visit", actionType: "VisitAndExtract" }],
      });

      expect(mockCreateActionExcludeLists).toHaveBeenCalledWith(5, 3);
    });

    it("throws CampaignExecutionError when CDP call fails", async () => {
      mockEvaluateUI.mockRejectedValueOnce(new Error("CDP timeout"));

      await expect(
        service.create({
          name: "Fail",
          actions: [{ name: "Visit", actionType: "VisitAndExtract" }],
        }),
      ).rejects.toThrow(CampaignExecutionError);
    });
  });

  describe("list", () => {
    it("delegates to campaignRepo.listCampaigns", () => {
      mockListCampaigns.mockReturnValue(MOCK_SUMMARIES);

      const result = service.list();

      expect(result).toEqual(MOCK_SUMMARIES);
      expect(mockListCampaigns).toHaveBeenCalledOnce();
    });

    it("returns empty array when no campaigns", () => {
      mockListCampaigns.mockReturnValue([]);

      const result = service.list();

      expect(result).toEqual([]);
    });
  });

  describe("get", () => {
    it("returns campaign from repository", () => {
      mockGetCampaign.mockReturnValue(MOCK_CAMPAIGN);

      const result = service.get(1);

      expect(result).toEqual(MOCK_CAMPAIGN);
      expect(mockGetCampaign).toHaveBeenCalledWith(1);
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      mockGetCampaign.mockImplementation(() => {
        throw new CampaignNotFoundError(999);
      });

      expect(() => service.get(999)).toThrow(CampaignNotFoundError);
    });
  });

  describe("delete", () => {
    it("archives the campaign via CDP", async () => {
      mockGetCampaign.mockReturnValue(MOCK_CAMPAIGN);
      mockEvaluateUI.mockResolvedValueOnce(undefined);

      await service.delete(1);

      expect(mockGetCampaign).toHaveBeenCalledWith(1);
      expect(mockEvaluateUI).toHaveBeenCalledOnce();
      const cdpExpr = mockEvaluateUI.mock.calls[0]?.[0] as string;
      expect(cdpExpr).toContain("setCampaignArchivedStatus");
      expect(cdpExpr).toContain("true");
    });

    it("throws CampaignNotFoundError for missing campaign", async () => {
      mockGetCampaign.mockImplementation(() => {
        throw new CampaignNotFoundError(999);
      });

      await expect(service.delete(999)).rejects.toThrow(CampaignNotFoundError);
    });

    it("throws CampaignExecutionError when CDP call fails", async () => {
      mockGetCampaign.mockReturnValue(MOCK_CAMPAIGN);
      mockEvaluateUI.mockRejectedValueOnce(new Error("CDP error"));

      await expect(service.delete(1)).rejects.toThrow(CampaignExecutionError);
    });
  });

  describe("start", () => {
    beforeEach(() => {
      mockGetCampaign.mockReturnValue(MOCK_CAMPAIGN);
    });

    it("performs full start sequence: reset, wait idle, unpause, start", async () => {
      // Runner is idle, unpause succeeds, start returns true
      mockEvaluateUI
        .mockResolvedValueOnce("idle")   // getRunnerState
        .mockResolvedValueOnce(undefined) // unpause
        .mockResolvedValueOnce(true);     // start

      const promise = service.start(1, [42]);
      await vi.advanceTimersByTimeAsync(100);
      await promise;

      // Step 1: Reset
      expect(mockResetForRerun).toHaveBeenCalledWith(1, [42]);

      // Step 2: Checked idle
      expect(mockEvaluateUI).toHaveBeenCalledTimes(3);

      // Step 3: Unpause
      const unpauseExpr = mockEvaluateUI.mock.calls[1]?.[0] as string;
      expect(unpauseExpr).toContain("setCampaignPaused");
      expect(unpauseExpr).toContain("false");

      // Step 4: Start
      const startExpr = mockEvaluateUI.mock.calls[2]?.[0] as string;
      expect(startExpr).toContain("campaignController.start()");
    });

    it("skips reset when personIds is empty", async () => {
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(true);

      const promise = service.start(1, []);
      await vi.advanceTimersByTimeAsync(100);
      await promise;

      expect(mockResetForRerun).not.toHaveBeenCalled();
    });

    it("waits for idle when runner is busy", async () => {
      mockEvaluateUI
        .mockResolvedValueOnce("campaigns")        // first poll: busy
        .mockResolvedValueOnce("stopping-campaigns") // second poll: stopping
        .mockResolvedValueOnce("idle")              // third poll: idle
        .mockResolvedValueOnce(undefined)           // unpause
        .mockResolvedValueOnce(true);               // start

      const promise = service.start(1, [42]);
      // Advance past the poll intervals
      await vi.advanceTimersByTimeAsync(3000);
      await promise;

      // Should have polled at least 3 times before proceeding
      expect(mockEvaluateUI.mock.calls.length).toBeGreaterThanOrEqual(5);
    });

    it("throws CampaignTimeoutError when runner does not reach idle", async () => {
      mockEvaluateUI.mockResolvedValue("campaigns"); // always busy

      const promise = service.start(1, [42]);
      const caughtPromise = promise.catch((e: unknown) => e);

      // Advance past the full timeout
      await vi.advanceTimersByTimeAsync(61_000);

      const error = await caughtPromise;
      expect(error).toBeInstanceOf(CampaignTimeoutError);
    });

    it("throws CampaignExecutionError when start() returns false", async () => {
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(false); // start returns false

      const promise = service.start(1, [42]);
      const caughtPromise = promise.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(100);

      const error = await caughtPromise;
      expect(error).toBeInstanceOf(CampaignExecutionError);
    });

    it("throws CampaignNotFoundError for missing campaign", async () => {
      mockGetCampaign.mockImplementation(() => {
        throw new CampaignNotFoundError(999);
      });

      await expect(service.start(999, [42])).rejects.toThrow(
        CampaignNotFoundError,
      );
    });
  });

  describe("stop", () => {
    it("pauses campaign and stops runner", async () => {
      mockGetCampaign.mockReturnValue(MOCK_CAMPAIGN);
      mockEvaluateUI
        .mockResolvedValueOnce(undefined) // pause
        .mockResolvedValueOnce(undefined); // stop

      await service.stop(1);

      expect(mockEvaluateUI).toHaveBeenCalledTimes(2);
      const pauseExpr = mockEvaluateUI.mock.calls[0]?.[0] as string;
      expect(pauseExpr).toContain("setCampaignPaused");
      expect(pauseExpr).toContain("true");

      const stopExpr = mockEvaluateUI.mock.calls[1]?.[0] as string;
      expect(stopExpr).toContain("campaignController.stop()");
    });

    it("throws CampaignNotFoundError for missing campaign", async () => {
      mockGetCampaign.mockImplementation(() => {
        throw new CampaignNotFoundError(999);
      });

      await expect(service.stop(999)).rejects.toThrow(CampaignNotFoundError);
    });

    it("throws CampaignExecutionError when CDP call fails", async () => {
      mockGetCampaign.mockReturnValue(MOCK_CAMPAIGN);
      mockEvaluateUI.mockRejectedValueOnce(new Error("CDP error"));

      await expect(service.stop(1)).rejects.toThrow(CampaignExecutionError);
    });
  });

  describe("getStatus", () => {
    it("combines DB state with CDP data", async () => {
      mockGetCampaign.mockReturnValue(MOCK_CAMPAIGN);
      mockGetCampaignActions.mockReturnValue(MOCK_ACTIONS);

      // CDP calls: runnerState, isPaused, then 1 batched action counts call
      mockEvaluateUI
        .mockResolvedValueOnce("idle")   // runnerState
        .mockResolvedValueOnce(true)     // isPaused
        .mockResolvedValueOnce({ queued: 5, processed: 3, successful: 2, failed: 1 });

      const status = await service.getStatus(1);

      expect(status.campaignState).toBe("paused");
      expect(status.isPaused).toBe(true);
      expect(status.runnerState).toBe("idle");
      expect(status.actionCounts).toHaveLength(1);
      expect(status.actionCounts[0]).toEqual({
        actionId: 10,
        queued: 5,
        processed: 3,
        successful: 2,
        failed: 1,
      });
    });

    it("throws CampaignNotFoundError for missing campaign", async () => {
      mockGetCampaign.mockImplementation(() => {
        throw new CampaignNotFoundError(999);
      });

      await expect(service.getStatus(999)).rejects.toThrow(
        CampaignNotFoundError,
      );
    });
  });

  describe("getResults", () => {
    it("combines DB results with CDP action counts", async () => {
      mockGetResults.mockReturnValue(MOCK_RESULTS);
      mockGetCampaignActions.mockReturnValue(MOCK_ACTIONS);

      // 1 batched action counts CDP call
      mockEvaluateUI
        .mockResolvedValueOnce({ queued: 0, processed: 0, successful: 1, failed: 0 });

      const result = await service.getResults(1);

      expect(result.campaignId).toBe(1);
      expect(result.results).toEqual(MOCK_RESULTS);
      expect(result.actionCounts).toHaveLength(1);
      expect(result.actionCounts[0]).toMatchObject({
        actionId: 10,
        successful: 1,
      });
    });

    it("throws CampaignNotFoundError for missing campaign", async () => {
      mockGetResults.mockImplementation(() => {
        throw new CampaignNotFoundError(999);
      });

      await expect(service.getResults(999)).rejects.toThrow(
        CampaignNotFoundError,
      );
    });
  });

  describe("removeAction", () => {
    it("removes action via CDP call", async () => {
      mockGetCampaignActions.mockReturnValue(MOCK_ACTIONS);
      mockEvaluateUI.mockResolvedValueOnce(undefined);

      await service.removeAction(1, 10);

      expect(mockGetCampaignActions).toHaveBeenCalledWith(1);
      expect(mockEvaluateUI).toHaveBeenCalledOnce();
      const cdpExpr = mockEvaluateUI.mock.calls[0]?.[0] as string;
      expect(cdpExpr).toContain("removeActionFromCampaignChain");
      expect(cdpExpr).toContain("10");
    });

    it("throws CampaignNotFoundError for missing campaign", async () => {
      mockGetCampaignActions.mockImplementation(() => {
        throw new CampaignNotFoundError(999);
      });

      await expect(service.removeAction(999, 10)).rejects.toThrow(
        CampaignNotFoundError,
      );
    });

    it("throws ActionNotFoundError for action not in campaign", async () => {
      mockGetCampaignActions.mockReturnValue(MOCK_ACTIONS);

      await expect(service.removeAction(1, 9999)).rejects.toThrow(
        ActionNotFoundError,
      );
    });

    it("throws CampaignExecutionError when CDP call fails", async () => {
      mockGetCampaignActions.mockReturnValue(MOCK_ACTIONS);
      mockEvaluateUI.mockRejectedValueOnce(new Error("CDP timeout"));

      await expect(service.removeAction(1, 10)).rejects.toThrow(
        CampaignExecutionError,
      );
    });
  });

  describe("reorderActions", () => {
    it("reorders actions via CDP calls", async () => {
      mockGetCampaignActions
        .mockReturnValueOnce(MOCK_ACTIONS) // validation call
        .mockReturnValueOnce(MOCK_ACTIONS); // return call after reorder
      mockEvaluateUI.mockResolvedValue(undefined);

      const result = await service.reorderActions(1, [10]);

      expect(result).toEqual(MOCK_ACTIONS);
    });

    it("calls moveActionInCampaignChain for each action at correct position", async () => {
      mockGetCampaignActions
        .mockReturnValueOnce(MOCK_ACTIONS)
        .mockReturnValueOnce(MOCK_ACTIONS);
      mockEvaluateUI.mockResolvedValue(undefined);

      await service.reorderActions(1, [10]);

      expect(mockEvaluateUI).toHaveBeenCalledOnce();
      const cdpExpr = mockEvaluateUI.mock.calls[0]?.[0] as string;
      expect(cdpExpr).toContain("moveActionInCampaignChain");
      expect(cdpExpr).toContain('"action":10');
      expect(cdpExpr).toContain('"at":0');
    });

    it("throws CampaignNotFoundError for missing campaign", async () => {
      mockGetCampaignActions.mockImplementation(() => {
        throw new CampaignNotFoundError(999);
      });

      await expect(service.reorderActions(999, [10])).rejects.toThrow(
        CampaignNotFoundError,
      );
    });

    it("throws ActionNotFoundError for invalid action IDs", async () => {
      mockGetCampaignActions.mockReturnValue(MOCK_ACTIONS);

      await expect(service.reorderActions(1, [9999])).rejects.toThrow(
        ActionNotFoundError,
      );
    });

    it("throws CampaignExecutionError when CDP call fails", async () => {
      mockGetCampaignActions.mockReturnValue(MOCK_ACTIONS);
      mockEvaluateUI.mockRejectedValueOnce(new Error("CDP error"));

      await expect(service.reorderActions(1, [10])).rejects.toThrow(
        CampaignExecutionError,
      );
    });

    it("returns updated action list from repository", async () => {
      const reorderedActions: CampaignAction[] = [
        MOCK_ACTIONS[0] as CampaignAction,
      ];
      mockGetCampaignActions
        .mockReturnValueOnce(MOCK_ACTIONS) // validation call
        .mockReturnValueOnce(reorderedActions); // return call
      mockEvaluateUI.mockResolvedValue(undefined);

      const result = await service.reorderActions(1, [10]);

      // getCampaignActions called twice: once for validation, once for return
      expect(mockGetCampaignActions).toHaveBeenCalledTimes(2);
      expect(result).toEqual(reorderedActions);
    });
  });
});
