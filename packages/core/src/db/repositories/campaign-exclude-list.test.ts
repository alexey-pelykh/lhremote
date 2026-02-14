// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseClient } from "../client.js";
import {
  ActionNotFoundError,
  CampaignNotFoundError,
  ExcludeListNotFoundError,
} from "../errors.js";
import { openFixture } from "../testing/open-fixture.js";
import { CampaignExcludeListRepository } from "./campaign-exclude-list.js";

describe("CampaignExcludeListRepository", () => {
  let db: DatabaseSync;
  let client: DatabaseClient;
  let repo: CampaignExcludeListRepository;

  beforeEach(() => {
    db = openFixture();
    client = { db } as DatabaseClient;
    repo = new CampaignExcludeListRepository(client);
  });

  afterEach(() => {
    db.close();
  });

  describe("getExcludeList", () => {
    // Campaign 1 has campaign-level exclude list with person 2 pre-populated
    // Campaign 5 has campaign-level exclude list (empty) and action-level lists (empty)

    it("returns campaign-level exclude list", () => {
      const entries = repo.getExcludeList(1);

      expect(entries).toEqual([{ personId: 2 }]);
    });

    it("returns empty list when no people excluded", () => {
      const entries = repo.getExcludeList(5);

      expect(entries).toEqual([]);
    });

    it("returns action-level exclude list", () => {
      const entries = repo.getExcludeList(1, 1);

      // Action 1's exclude list (collection 2) has no people
      expect(entries).toEqual([]);
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.getExcludeList(999)).toThrow(CampaignNotFoundError);
    });

    it("throws ActionNotFoundError for action not in campaign", () => {
      expect(() => repo.getExcludeList(1, 999)).toThrow(ActionNotFoundError);
    });

    it("throws ExcludeListNotFoundError when campaign has no exclude list chain", () => {
      // Campaign 2 has no campaign_versions entry
      expect(() => repo.getExcludeList(2)).toThrow(ExcludeListNotFoundError);
    });

    it("returns entries ordered by person_id", () => {
      // Add multiple people to campaign 1's exclude list
      db.exec(`
        INSERT INTO collection_people (collection_id, person_id) VALUES (1, 3);
        INSERT INTO collection_people (collection_id, person_id) VALUES (1, 1);
      `);

      const entries = repo.getExcludeList(1);

      expect(entries.map((e) => e.personId)).toEqual([1, 2, 3]);
    });
  });

  describe("addToExcludeList", () => {
    it("adds people to campaign-level exclude list", () => {
      const added = repo.addToExcludeList(1, [1, 3]);

      expect(added).toBe(2);

      // Verify in database
      const entries = repo.getExcludeList(1);
      expect(entries.map((e) => e.personId)).toContain(1);
      expect(entries.map((e) => e.personId)).toContain(3);
    });

    it("skips already-excluded people", () => {
      // Person 2 is already in campaign 1's exclude list
      const added = repo.addToExcludeList(1, [2, 3]);

      expect(added).toBe(1); // Only person 3 was newly added

      const entries = repo.getExcludeList(1);
      expect(entries).toHaveLength(2); // Person 2 (existing) + person 3 (new)
    });

    it("adds people to action-level exclude list", () => {
      const added = repo.addToExcludeList(1, [1], 1);

      expect(added).toBe(1);

      const entries = repo.getExcludeList(1, 1);
      expect(entries).toEqual([{ personId: 1 }]);
    });

    it("returns 0 for empty person list", () => {
      const added = repo.addToExcludeList(1, []);

      expect(added).toBe(0);
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.addToExcludeList(999, [1])).toThrow(
        CampaignNotFoundError,
      );
    });

    it("throws ActionNotFoundError for action not in campaign", () => {
      expect(() => repo.addToExcludeList(1, [1], 999)).toThrow(
        ActionNotFoundError,
      );
    });

    it("throws ExcludeListNotFoundError when exclude list chain missing", () => {
      expect(() => repo.addToExcludeList(2, [1])).toThrow(
        ExcludeListNotFoundError,
      );
    });
  });

  describe("removeFromExcludeList", () => {
    it("removes people from campaign-level exclude list", () => {
      // Person 2 is in campaign 1's exclude list
      const removed = repo.removeFromExcludeList(1, [2]);

      expect(removed).toBe(1);

      const entries = repo.getExcludeList(1);
      expect(entries).toEqual([]);
    });

    it("returns 0 for people not in the list", () => {
      const removed = repo.removeFromExcludeList(1, [999]);

      expect(removed).toBe(0);
    });

    it("removes people from action-level exclude list", () => {
      // First add a person to action 1's exclude list
      repo.addToExcludeList(1, [1], 1);

      const removed = repo.removeFromExcludeList(1, [1], 1);

      expect(removed).toBe(1);

      const entries = repo.getExcludeList(1, 1);
      expect(entries).toEqual([]);
    });

    it("handles mixed present and absent people", () => {
      // Person 2 is in the list, person 999 is not
      const removed = repo.removeFromExcludeList(1, [2, 999]);

      expect(removed).toBe(1);
    });

    it("returns 0 for empty person list", () => {
      const removed = repo.removeFromExcludeList(1, []);

      expect(removed).toBe(0);
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.removeFromExcludeList(999, [1])).toThrow(
        CampaignNotFoundError,
      );
    });

    it("throws ActionNotFoundError for action not in campaign", () => {
      expect(() => repo.removeFromExcludeList(1, [1], 999)).toThrow(
        ActionNotFoundError,
      );
    });

    it("throws ExcludeListNotFoundError when exclude list chain missing", () => {
      expect(() => repo.removeFromExcludeList(2, [1])).toThrow(
        ExcludeListNotFoundError,
      );
    });
  });
});
