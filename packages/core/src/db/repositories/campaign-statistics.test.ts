// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseClient } from "../client.js";
import {
  ActionNotFoundError,
  CampaignNotFoundError,
} from "../errors.js";
import { openFixture } from "../testing/open-fixture.js";
import { CampaignStatisticsRepository } from "./campaign-statistics.js";

describe("CampaignStatisticsRepository", () => {
  let db: DatabaseSync;
  let client: DatabaseClient;
  let repo: CampaignStatisticsRepository;

  beforeEach(() => {
    db = openFixture();
    client = { db } as DatabaseClient;
    repo = new CampaignStatisticsRepository(client);
  });

  afterEach(() => {
    db.close();
  });

  describe("getStatistics", () => {
    // Campaign 1 fixture data:
    //   Action 1 ("Send Welcome Message", MessageToPerson) with 4 results:
    //     person 1: result=1 (successful)
    //     person 3: result=2 (replied)
    //     person 2: result=-1 (failed)
    //     person 4: result=-2 (skipped)
    //   Error flags (code != NULL):
    //     code=100, is_exception=0, who_to_blame='LinkedIn' (x2)
    //     code=200, is_exception=1, who_to_blame='LH' (x1)

    it("returns per-action breakdown for a campaign", () => {
      const stats = repo.getStatistics(1);

      expect(stats.campaignId).toBe(1);
      expect(stats.actions).toHaveLength(1);

      const action = stats.actions.at(0);
      expect(action).toBeDefined();
      expect(action).toMatchObject({
        actionId: 1,
        actionName: "Send Welcome Message",
        actionType: "MessageToPerson",
      });
    });

    it("counts successful/replied/failed/skipped correctly", () => {
      const stats = repo.getStatistics(1);

      const action = stats.actions.at(0);
      expect(action).toBeDefined();
      expect(action?.successful).toBe(1);
      expect(action?.replied).toBe(1);
      expect(action?.failed).toBe(1);
      expect(action?.skipped).toBe(1);
      expect(action?.total).toBe(4);
    });

    it("calculates success rate correctly", () => {
      const stats = repo.getStatistics(1);

      const action = stats.actions.at(0);
      expect(action).toBeDefined();
      // successRate = round(((successful + replied) / total) * 1000) / 10
      // = round(((1 + 1) / 4) * 1000) / 10 = round(500) / 10 = 50
      expect(action?.successRate).toBe(50);
    });

    it("returns top errors with blame attribution", () => {
      const stats = repo.getStatistics(1);

      const action = stats.actions.at(0);
      expect(action).toBeDefined();
      const errors = action?.topErrors ?? [];

      expect(errors).toHaveLength(2);
      expect(errors.at(0)).toMatchObject({
        code: 100,
        count: 2,
        isException: false,
        whoToBlame: "LinkedIn",
      });
      expect(errors.at(1)).toMatchObject({
        code: 200,
        count: 1,
        isException: true,
        whoToBlame: "LH",
      });
    });

    it("orders top errors by count descending", () => {
      const stats = repo.getStatistics(1);

      const action = stats.actions.at(0);
      expect(action).toBeDefined();
      const errors = action?.topErrors ?? [];

      for (let i = 1; i < errors.length; i++) {
        expect(errors[i - 1]?.count).toBeGreaterThanOrEqual(
          errors[i]?.count ?? 0,
        );
      }
    });

    it("respects maxErrors option", () => {
      const stats = repo.getStatistics(1, { maxErrors: 1 });

      const action = stats.actions.at(0);
      expect(action).toBeDefined();
      const errors = action?.topErrors ?? [];

      expect(errors).toHaveLength(1);
      expect(errors.at(0)?.code).toBe(100);
    });

    it("filters by actionId when provided", () => {
      const stats = repo.getStatistics(1, { actionId: 1 });

      expect(stats.actions).toHaveLength(1);
      expect(stats.actions.at(0)?.actionId).toBe(1);
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.getStatistics(999)).toThrow(CampaignNotFoundError);
    });

    it("throws ActionNotFoundError for invalid actionId", () => {
      expect(() => repo.getStatistics(1, { actionId: 999 })).toThrow(
        ActionNotFoundError,
      );
    });

    it("handles campaign with no results", () => {
      // Campaign 3 has no actions (archived)
      const stats = repo.getStatistics(3);

      expect(stats.campaignId).toBe(3);
      expect(stats.actions).toHaveLength(0);
      expect(stats.totals).toMatchObject({
        successful: 0,
        replied: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        successRate: 0,
      });
    });

    it("aggregates totals across all actions", () => {
      const stats = repo.getStatistics(1);

      expect(stats.totals).toMatchObject({
        successful: 1,
        replied: 1,
        failed: 1,
        skipped: 1,
        total: 4,
        successRate: 50,
      });
    });

    it("includes first and last result timestamps", () => {
      const stats = repo.getStatistics(1);

      const action = stats.actions.at(0);
      expect(action).toBeDefined();
      expect(action?.firstResultAt).toBe("2025-01-15T12:30:00.000Z");
      expect(action?.lastResultAt).toBe("2025-01-15T14:00:00.000Z");
    });
  });

  describe("resetForRerun", () => {
    it("resets person state for re-run", () => {
      // Initial state: person 1 has state=2 (processed), person 3 has state=1 (queued)
      const initialTargets = db
        .prepare(
          "SELECT person_id, state FROM action_target_people WHERE action_id = 1",
        )
        .all() as Array<{ person_id: number; state: number }>;

      const initialPerson1 = initialTargets.find((t) => t.person_id === 1);
      expect(initialPerson1).toBeDefined();
      expect(initialPerson1?.state).toBe(2);

      // Reset person 1
      repo.resetForRerun(1, [1]);

      // Verify state reset to 1 (queued)
      const afterTargets = db
        .prepare(
          "SELECT person_id, state FROM action_target_people WHERE action_id = 1",
        )
        .all() as Array<{ person_id: number; state: number }>;

      const afterPerson1 = afterTargets.find((t) => t.person_id === 1);
      expect(afterPerson1).toBeDefined();
      expect(afterPerson1?.state).toBe(1);
    });

    it("resets campaign history for re-run", () => {
      // Initial state: person 1 has result_status=1 (success)
      const initialHistory = db
        .prepare(
          "SELECT result_status FROM person_in_campaigns_history WHERE campaign_id = 1 AND person_id = 1",
        )
        .get() as { result_status: number } | undefined;

      expect(initialHistory).toBeDefined();
      expect(initialHistory?.result_status).toBe(1);

      // Reset person 1
      repo.resetForRerun(1, [1]);

      // Verify result_status reset to -999
      const afterHistory = db
        .prepare(
          "SELECT result_status FROM person_in_campaigns_history WHERE campaign_id = 1 AND person_id = 1",
        )
        .get() as { result_status: number } | undefined;

      expect(afterHistory).toBeDefined();
      expect(afterHistory?.result_status).toBe(-999);
    });

    it("deletes old action results and related records", () => {
      // Verify initial state has results
      const initialResults = db
        .prepare(
          "SELECT id FROM action_results WHERE action_version_id = 1 AND person_id = 1",
        )
        .all() as Array<{ id: number }>;
      expect(initialResults).toHaveLength(1);

      const initialFlags = db
        .prepare(
          "SELECT id FROM action_result_flags WHERE action_result_id = 1",
        )
        .all();
      expect(initialFlags).toHaveLength(1);

      const initialMessages = db
        .prepare(
          "SELECT id FROM action_result_messages WHERE action_result_id = 1",
        )
        .all();
      expect(initialMessages).toHaveLength(1);

      // Reset person 1
      repo.resetForRerun(1, [1]);

      // Verify all deleted
      const afterResults = db
        .prepare(
          "SELECT id FROM action_results WHERE action_version_id = 1 AND person_id = 1",
        )
        .all();
      expect(afterResults).toHaveLength(0);

      const afterFlags = db
        .prepare(
          "SELECT id FROM action_result_flags WHERE action_result_id = 1",
        )
        .all();
      expect(afterFlags).toHaveLength(0);

      const afterMessages = db
        .prepare(
          "SELECT id FROM action_result_messages WHERE action_result_id = 1",
        )
        .all();
      expect(afterMessages).toHaveLength(0);
    });

    it("handles multiple persons in a single reset", () => {
      repo.resetForRerun(1, [1, 3]);

      // Both persons should have state=1
      const targets = db
        .prepare(
          "SELECT person_id, state FROM action_target_people WHERE action_id = 1",
        )
        .all() as Array<{ person_id: number; state: number }>;

      const stateByPerson = new Map(targets.map((t) => [t.person_id, t.state]));
      expect(stateByPerson.get(1)).toBe(1);
      expect(stateByPerson.get(3)).toBe(1);
    });

    it("handles empty person list gracefully", () => {
      // Should not throw
      expect(() => repo.resetForRerun(1, [])).not.toThrow();
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.resetForRerun(999, [1])).toThrow(CampaignNotFoundError);
    });

    it("handles campaign with no actions gracefully", () => {
      // Campaign 3 has no actions
      expect(() => repo.resetForRerun(3, [1])).not.toThrow();
    });
  });

  describe("resetForRerun — rollback", () => {
    it("rolls back transaction on error and preserves database state", () => {
      // Snapshot initial state
      const initialTargets = db
        .prepare(
          "SELECT person_id, state FROM action_target_people WHERE action_id = 1 ORDER BY person_id",
        )
        .all() as Array<{ person_id: number; state: number }>;

      const initialHistory = db
        .prepare(
          "SELECT person_id, result_status FROM person_in_campaigns_history WHERE campaign_id = 1 ORDER BY person_id",
        )
        .all() as Array<{ person_id: number; result_status: number }>;

      const initialResults = db
        .prepare(
          "SELECT id FROM action_results WHERE action_version_id = 1 ORDER BY id",
        )
        .all() as Array<{ id: number }>;

      // Sabotage a write statement to force an error mid-transaction
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- private method access for rollback test
      const stmts = (repo as any).getWriteStatements();
      const originalRun = stmts.resetHistory.run.bind(stmts.resetHistory);
      stmts.resetHistory.run = () => {
        throw new Error("Simulated DB error");
      };

      // Attempt reset — should throw the simulated error
      expect(() => repo.resetForRerun(1, [1])).toThrow("Simulated DB error");

      // Restore original to avoid side effects
      stmts.resetHistory.run = originalRun;

      // Verify database state is unchanged (ROLLBACK worked)
      const afterTargets = db
        .prepare(
          "SELECT person_id, state FROM action_target_people WHERE action_id = 1 ORDER BY person_id",
        )
        .all() as Array<{ person_id: number; state: number }>;

      const afterHistory = db
        .prepare(
          "SELECT person_id, result_status FROM person_in_campaigns_history WHERE campaign_id = 1 ORDER BY person_id",
        )
        .all() as Array<{ person_id: number; result_status: number }>;

      const afterResults = db
        .prepare(
          "SELECT id FROM action_results WHERE action_version_id = 1 ORDER BY id",
        )
        .all() as Array<{ id: number }>;

      expect(afterTargets).toEqual(initialTargets);
      expect(afterHistory).toEqual(initialHistory);
      expect(afterResults).toEqual(initialResults);
    });
  });
});
