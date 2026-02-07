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
const mockResetForRerun = vi.fn();

vi.mock("../db/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/index.js")>();
  return {
    CampaignRepository: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.listCampaigns = mockListCampaigns;
      this.getCampaign = mockGetCampaign;
      this.getCampaignActions = mockGetCampaignActions;
      this.getResults = mockGetResults;
      this.resetForRerun = mockResetForRerun;
    }),
    CampaignNotFoundError: original.CampaignNotFoundError,
  };
});

import { CampaignNotFoundError } from "../db/index.js";
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

      // CDP calls: runnerState, isPaused, then 4 action counts
      mockEvaluateUI
        .mockResolvedValueOnce("idle")   // runnerState
        .mockResolvedValueOnce(true)     // isPaused
        .mockResolvedValueOnce(5)        // queued
        .mockResolvedValueOnce(3)        // processed
        .mockResolvedValueOnce(2)        // successful
        .mockResolvedValueOnce(1);       // failed

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

      // 4 action count CDP calls
      mockEvaluateUI
        .mockResolvedValueOnce(0)  // queued
        .mockResolvedValueOnce(0)  // processed
        .mockResolvedValueOnce(1)  // successful
        .mockResolvedValueOnce(0); // failed

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
});
