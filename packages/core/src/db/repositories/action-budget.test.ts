// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseClient } from "../client.js";
import { ActionBudgetRepository } from "./action-budget.js";

function createBudgetDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");

  db.exec(`
    CREATE TABLE limit_types (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL
    )
  `);
  db.exec(`
    INSERT INTO limit_types (id, type) VALUES
      (8, 'Invite'),
      (9, 'Message'),
      (16, 'Follow'),
      (18, 'PostLike')
  `);

  db.exec(`
    CREATE TABLE daily_limits (
      id INTEGER PRIMARY KEY,
      max_limit INTEGER NOT NULL
    )
  `);
  db.exec(`
    INSERT INTO daily_limits (id, max_limit) VALUES
      (8, 100),
      (16, 150)
  `);

  db.exec(`
    CREATE TABLE action_configs (
      id INTEGER PRIMARY KEY,
      actionType TEXT NOT NULL
    )
  `);
  db.exec(`INSERT INTO action_configs (id, actionType) VALUES (1, 'InvitePerson')`);
  db.exec(`INSERT INTO action_configs (id, actionType) VALUES (2, 'Follow')`);

  db.exec(`
    CREATE TABLE action_versions (
      id INTEGER PRIMARY KEY,
      action_id INTEGER NOT NULL,
      config_id INTEGER NOT NULL
    )
  `);
  db.exec(`INSERT INTO action_versions (id, action_id, config_id) VALUES (1, 1, 1)`);
  db.exec(`INSERT INTO action_versions (id, action_id, config_id) VALUES (2, 2, 2)`);

  db.exec(`
    CREATE TABLE action_results (
      id INTEGER PRIMARY KEY,
      action_version_id INTEGER NOT NULL,
      person_id INTEGER NOT NULL,
      result INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL
    )
  `);

  // Insert today's results
  const today = new Date().toISOString().split("T")[0] ?? "";
  db.exec(`
    INSERT INTO action_results (action_version_id, person_id, result, created_at)
    VALUES
      (1, 100, 1, '${today} 10:00:00'),
      (1, 101, 1, '${today} 10:05:00'),
      (1, 102, -1, '${today} 10:10:00'),
      (2, 200, 1, '${today} 11:00:00')
  `);

  // Insert yesterday's results (should NOT be counted)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split("T")[0] ?? "";
  db.exec(`
    INSERT INTO action_results (action_version_id, person_id, result, created_at)
    VALUES
      (1, 103, 1, '${yesterday} 10:00:00'),
      (2, 201, 1, '${yesterday} 11:00:00')
  `);

  return db;
}

describe("ActionBudgetRepository", () => {
  let db: DatabaseSync;
  let repo: ActionBudgetRepository;

  beforeEach(() => {
    db = createBudgetDb();
    repo = new ActionBudgetRepository({ db } as DatabaseClient);
  });

  afterEach(() => {
    db.close();
  });

  describe("getLimitTypes", () => {
    it("returns all limit types ordered by ID", () => {
      const types = repo.getLimitTypes();

      expect(types).toEqual([
        { id: 8, type: "Invite" },
        { id: 9, type: "Message" },
        { id: 16, type: "Follow" },
        { id: 18, type: "PostLike" },
      ]);
    });
  });

  describe("getActionBudget", () => {
    it("combines limit types, daily limits, and today's usage", () => {
      const entries = repo.getActionBudget();

      // Invite: limit 100, 3 today (2 success + 1 fail — all results counted)
      const invite = entries.find((e) => e.limitType === "Invite");
      expect(invite).toEqual({
        limitTypeId: 8,
        limitType: "Invite",
        dailyLimit: 100,
        campaignUsed: 3,
        directUsed: 0,
        totalUsed: 3,
        remaining: 97,
      });

      // Follow: limit 150, 1 today
      const follow = entries.find((e) => e.limitType === "Follow");
      expect(follow).toEqual({
        limitTypeId: 16,
        limitType: "Follow",
        dailyLimit: 150,
        campaignUsed: 1,
        directUsed: 0,
        totalUsed: 1,
        remaining: 149,
      });

      // Message: no daily limit configured, 0 used
      const message = entries.find((e) => e.limitType === "Message");
      expect(message).toEqual({
        limitTypeId: 9,
        limitType: "Message",
        dailyLimit: null,
        campaignUsed: 0,
        directUsed: 0,
        totalUsed: 0,
        remaining: null,
      });
    });

    it("includes direct counts in budget", () => {
      const directCounts = new Map([[18, 5]]);
      const entries = repo.getActionBudget(directCounts);

      const postLike = entries.find((e) => e.limitType === "PostLike");
      expect(postLike).toEqual({
        limitTypeId: 18,
        limitType: "PostLike",
        dailyLimit: null,
        campaignUsed: 0,
        directUsed: 5,
        totalUsed: 5,
        remaining: null,
      });
    });

    it("clamps remaining to zero when over limit", () => {
      const directCounts = new Map([[8, 200]]);
      const entries = repo.getActionBudget(directCounts);

      const invite = entries.find((e) => e.limitType === "Invite");
      expect(invite?.remaining).toBe(0);
      expect(invite?.totalUsed).toBe(203); // 3 campaign + 200 direct
    });

    it("returns empty entries when no limit types exist", () => {
      const emptyDb = new DatabaseSync(":memory:");
      emptyDb.exec(`CREATE TABLE limit_types (id INTEGER PRIMARY KEY, type TEXT NOT NULL)`);
      emptyDb.exec(`CREATE TABLE daily_limits (id INTEGER PRIMARY KEY, max_limit INTEGER NOT NULL)`);
      emptyDb.exec(`
        CREATE TABLE action_results (
          id INTEGER PRIMARY KEY, action_version_id INTEGER NOT NULL,
          person_id INTEGER NOT NULL, result INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL
        )
      `);
      emptyDb.exec(`
        CREATE TABLE action_versions (
          id INTEGER PRIMARY KEY, action_id INTEGER NOT NULL, config_id INTEGER NOT NULL
        )
      `);
      emptyDb.exec(`CREATE TABLE action_configs (id INTEGER PRIMARY KEY, actionType TEXT NOT NULL)`);

      const emptyRepo = new ActionBudgetRepository({ db: emptyDb } as DatabaseClient);
      const entries = emptyRepo.getActionBudget();
      expect(entries).toEqual([]);
      emptyDb.close();
    });
  });
});
