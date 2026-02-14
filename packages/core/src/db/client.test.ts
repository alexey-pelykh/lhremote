// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseClient } from "./client.js";
import { openFixture } from "./testing/open-fixture.js";

describe("DatabaseClient", () => {
  describe("constructor", () => {
    it("throws when the database file does not exist", () => {
      expect(
        () => new DatabaseClient("/nonexistent/path/to/lh.db"),
      ).toThrow();
    });
  });

  describe("with in-memory fixture", () => {
    let client: { db: ReturnType<typeof openFixture> };

    beforeEach(() => {
      const db = openFixture();
      client = { db };
    });

    afterEach(() => {
      client.db.close();
    });

    it("can read data from the real schema", () => {
      const row = client.db
        .prepare("SELECT first_name FROM person_mini_profile WHERE person_id = ?")
        .get(1) as { first_name: string } | undefined;
      expect(row?.first_name).toBe("Ada");
    });

    it("fixture schema includes all profile-related tables", () => {
      const tables = [
        "people",
        "person_mini_profile",
        "person_external_ids",
        "person_current_position",
        "person_positions",
        "person_education",
        "skills",
        "person_skill",
        "person_email",
      ];

      for (const table of tables) {
        const row = client.db
          .prepare(`SELECT COUNT(*) AS cnt FROM ${table}`)
          .get() as { cnt: number };
        expect(row.cnt).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
