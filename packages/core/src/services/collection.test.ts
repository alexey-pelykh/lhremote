// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CollectionBusyError, CollectionError } from "./errors.js";
import { CollectionService } from "./collection.js";

// Mock InstanceService
const mockEvaluateUI = vi.fn();
const mockNavigateLinkedIn = vi.fn().mockResolvedValue(undefined);

vi.mock("./instance.js", () => ({
  InstanceService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.evaluateUI = mockEvaluateUI;
    this.navigateLinkedIn = mockNavigateLinkedIn;
  }),
}));

import { InstanceService } from "./instance.js";

/** LinkedIn people search URL for tests. */
const SEARCH_URL =
  "https://www.linkedin.com/search/results/people/?keywords=software%20engineer";

/** LinkedIn company people URL for tests. */
const ORG_PEOPLE_URL =
  "https://www.linkedin.com/company/acme-corp/people/";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CollectionService", () => {
  let service: CollectionService;

  beforeEach(() => {
    vi.clearAllMocks();

    const instance = new InstanceService(9223);
    service = new CollectionService(instance);
  });

  describe("collect", () => {
    it("navigates, then calls canCollect, prepareCollecting, and collect via CDP", async () => {
      mockEvaluateUI
        .mockResolvedValueOnce("idle")  // getRunnerState
        .mockResolvedValueOnce(true)    // canCollect
        .mockResolvedValueOnce(true)    // prepareCollecting
        .mockResolvedValueOnce(true);   // collect

      await service.collect(SEARCH_URL, 1);

      // Navigation via LinkedIn webview
      expect(mockNavigateLinkedIn).toHaveBeenCalledWith(SEARCH_URL);

      expect(mockEvaluateUI).toHaveBeenCalledTimes(4);

      // 1. Runner state check
      const stateExpr = mockEvaluateUI.mock.calls[0]?.[0] as string;
      expect(stateExpr).toContain("mainWindowService.mainWindow.state");

      // 2. canCollect — uses internal kebab-case type
      const canCollectExpr = mockEvaluateUI.mock.calls[1]?.[0] as string;
      expect(canCollectExpr).toContain("canCollect");
      expect(canCollectExpr).toContain("search-page");

      // 3. prepareCollecting — uses internal kebab-case type
      const prepareExpr = mockEvaluateUI.mock.calls[2]?.[0] as string;
      expect(prepareExpr).toContain("prepareCollecting");
      expect(prepareExpr).toContain("search-page");
      expect(prepareExpr).toContain("AutoCollectPeople");

      // 4. collect — includes campaignId
      const collectExpr = mockEvaluateUI.mock.calls[3]?.[0] as string;
      expect(collectExpr).toContain("mws.call('collect'");
      expect(collectExpr).toContain('"campaignId":1');
    });

    it("passes limit, maxPages, pageSize to collect call", async () => {
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      await service.collect(SEARCH_URL, 1, {
        limit: 100,
        maxPages: 5,
        pageSize: 25,
      });

      const collectExpr = mockEvaluateUI.mock.calls[3]?.[0] as string;
      expect(collectExpr).toContain('"limit":100');
      expect(collectExpr).toContain('"maxPages":5');
      expect(collectExpr).toContain('"pageSize":25');
    });

    it("omits undefined options from collect call", async () => {
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      await service.collect(SEARCH_URL, 1, { limit: 50 });

      const collectExpr = mockEvaluateUI.mock.calls[3]?.[0] as string;
      expect(collectExpr).toContain('"limit":50');
      expect(collectExpr).not.toContain("maxPages");
      expect(collectExpr).not.toContain("pageSize");
    });

    it("detects OrganizationPeople source type from company URL", async () => {
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      await service.collect(ORG_PEOPLE_URL, 1);

      const canCollectExpr = mockEvaluateUI.mock.calls[1]?.[0] as string;
      expect(canCollectExpr).toContain("organization-people");

      const prepareExpr = mockEvaluateUI.mock.calls[2]?.[0] as string;
      expect(prepareExpr).toContain("organization-people");
    });

    it("throws CollectionError for unrecognized source URL", async () => {
      const error = await service
        .collect("https://www.linkedin.com/feed/", 1)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CollectionError);
      expect((error as CollectionError).message).toContain("Unrecognized source URL");

      // No CDP calls should be made
      expect(mockEvaluateUI).not.toHaveBeenCalled();
    });

    it("throws CollectionBusyError when runner is not idle", async () => {
      mockEvaluateUI.mockResolvedValueOnce("campaigns");

      await expect(
        service.collect(SEARCH_URL, 1),
      ).rejects.toThrow(CollectionBusyError);

      // Only the runner state check should be made
      expect(mockEvaluateUI).toHaveBeenCalledTimes(1);
    });

    it("includes runner state in CollectionBusyError", async () => {
      mockEvaluateUI.mockResolvedValueOnce("campaigns");

      try {
        await service.collect(SEARCH_URL, 1);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CollectionBusyError);
        expect((error as CollectionBusyError).runnerState).toBe("campaigns");
      }
    });

    describe("canCollect polling", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("polls canCollect until it returns true after initial failures", async () => {
        mockEvaluateUI
          .mockResolvedValueOnce("idle")   // getRunnerState
          .mockResolvedValueOnce(false)     // canCollect attempt 1
          .mockResolvedValueOnce(false)     // canCollect attempt 2
          .mockResolvedValueOnce(true)      // canCollect attempt 3 — success
          .mockResolvedValueOnce(true)      // prepareCollecting
          .mockResolvedValueOnce(true);     // collect

        const promise = service.collect(SEARCH_URL, 1);
        await vi.advanceTimersByTimeAsync(2000);
        await promise;

        // canCollect was called 3 times before success
        const canCollectCalls = mockEvaluateUI.mock.calls.filter(
          (call) =>
            (call[0] as string).includes("canCollect") &&
            !(call[0] as string).includes("prepareCollecting"),
        );
        expect(canCollectCalls).toHaveLength(3);
      });

      it("succeeds on first canCollect check without polling delay", async () => {
        mockEvaluateUI
          .mockResolvedValueOnce("idle")   // getRunnerState
          .mockResolvedValueOnce(true)      // canCollect — immediate success
          .mockResolvedValueOnce(true)      // prepareCollecting
          .mockResolvedValueOnce(true);     // collect

        const promise = service.collect(SEARCH_URL, 1);
        await vi.advanceTimersByTimeAsync(0);
        await promise;

        // Only 1 canCollect call — no polling needed
        const canCollectCalls = mockEvaluateUI.mock.calls.filter(
          (call) =>
            (call[0] as string).includes("canCollect") &&
            !(call[0] as string).includes("prepareCollecting"),
        );
        expect(canCollectCalls).toHaveLength(1);
      });

      it("throws CollectionError after polling timeout with elapsed time", async () => {
        mockEvaluateUI
          .mockResolvedValueOnce("idle")   // getRunnerState
          .mockResolvedValue(false);        // canCollect always returns false

        // Attach catch before advancing timers to avoid unhandled rejection
        const errorPromise = service.collect(SEARCH_URL, 1).catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(11_000);

        const error = await errorPromise;
        expect(error).toBeInstanceOf(CollectionError);
        expect((error as CollectionError).message).toContain("not on a matching page");
        expect((error as CollectionError).message).toMatch(/polled for \d+ms/);

        // Navigation should have been attempted before polling
        expect(mockNavigateLinkedIn).toHaveBeenCalledWith(SEARCH_URL);
      });
    });

    it("throws CollectionError when navigation fails", async () => {
      mockEvaluateUI.mockResolvedValueOnce("idle"); // getRunnerState
      mockNavigateLinkedIn.mockRejectedValueOnce(new Error("Page.navigate timeout"));

      const error = await service.collect(SEARCH_URL, 1).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CollectionError);
      expect((error as CollectionError).message).toContain("Failed to navigate to source URL");
      expect((error as CollectionError).cause).toBeInstanceOf(Error);

      // canCollect should not be called after navigation failure
      expect(mockEvaluateUI).toHaveBeenCalledTimes(1);
    });

    it("throws CollectionError when prepareCollecting returns false", async () => {
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false); // prepareCollecting returns false

      await expect(
        service.collect(SEARCH_URL, 1),
      ).rejects.toThrow(CollectionError);
    });

    it("throws CollectionError when collect returns false", async () => {
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false); // collect returns false

      await expect(
        service.collect(SEARCH_URL, 1),
      ).rejects.toThrow(CollectionError);
    });

    it("wraps CDP errors in CollectionError for prepareCollecting", async () => {
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error("CDP timeout"));

      const error = await service.collect(SEARCH_URL, 1).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CollectionError);
      expect((error as CollectionError).message).toContain("Failed to prepare collection");
      expect((error as CollectionError).cause).toBeInstanceOf(Error);
    });

    it("wraps CDP errors in CollectionError for collect", async () => {
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error("CDP timeout"));

      const error = await service.collect(SEARCH_URL, 1).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CollectionError);
      expect((error as CollectionError).message).toContain("Failed to start collection");
      expect((error as CollectionError).cause).toBeInstanceOf(Error);
    });

    it("does not wrap CollectionError from prepareCollecting", async () => {
      mockEvaluateUI
        .mockResolvedValueOnce("idle")
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false); // triggers CollectionError inside prepareCollecting

      const error = await service.collect(SEARCH_URL, 1).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CollectionError);
      expect((error as CollectionError).message).toContain("prepareCollecting returned false");
    });
  });

  describe("canCollect", () => {
    it("calls canCollect IPC method via CDP with internal kebab-case type", async () => {
      mockEvaluateUI.mockResolvedValueOnce(true);

      const result = await service.canCollect("SearchPage");

      expect(result).toBe(true);
      const expr = mockEvaluateUI.mock.calls[0]?.[0] as string;
      expect(expr).toContain("canCollect");
      expect(expr).toContain("search-page");
    });

    it("returns false when LinkedHelper reports false", async () => {
      mockEvaluateUI.mockResolvedValueOnce(false);

      const result = await service.canCollect("MyConnections");

      expect(result).toBe(false);
    });
  });

  describe("getRunnerState", () => {
    it("reads state from mainWindow.state via CDP", async () => {
      mockEvaluateUI.mockResolvedValueOnce("idle");

      const state = await service.getRunnerState();

      expect(state).toBe("idle");
      const expr = mockEvaluateUI.mock.calls[0]?.[0] as string;
      expect(expr).toContain("mainWindowService.mainWindow.state");
    });

    it("returns non-idle states", async () => {
      mockEvaluateUI.mockResolvedValueOnce("campaigns");

      const state = await service.getRunnerState();

      expect(state).toBe("campaigns");
    });
  });
});
