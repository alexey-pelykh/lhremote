import { afterEach, describe, expect, it } from "vitest";

import { DatabaseClient } from "./client.js";
import { FIXTURE_PATH } from "./testing/open-fixture.js";

describe("DatabaseClient (integration)", () => {
  let client: DatabaseClient | undefined;

  afterEach(() => {
    client?.close();
    client = undefined;
  });

  it("opens the fixture database in read-only mode", () => {
    client = new DatabaseClient(FIXTURE_PATH);
    expect(client.db.readonly).toBe(true);
  });

  it("reads data from the real schema", () => {
    client = new DatabaseClient(FIXTURE_PATH);

    const row = client.db
      .prepare("SELECT first_name FROM person_mini_profile WHERE person_id = ?")
      .get(1) as { first_name: string } | undefined;

    expect(row?.first_name).toBe("Ada");
  });

  it("rejects write operations", () => {
    client = new DatabaseClient(FIXTURE_PATH);
    const { db } = client;

    expect(() =>
      db.exec("INSERT INTO people (id) VALUES (9999)"),
    ).toThrow(/readonly/i);
  });

  it("throws when the database file does not exist", () => {
    expect(
      () => new DatabaseClient("/nonexistent/path/to/lh.db"),
    ).toThrow();
  });

  it("can query all profile-related tables", () => {
    client = new DatabaseClient(FIXTURE_PATH);

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

  it("close() releases the file handle", () => {
    client = new DatabaseClient(FIXTURE_PATH);
    const { db } = client;
    client.close();

    // After close, queries should throw
    expect(() =>
      db.prepare("SELECT 1").get(),
    ).toThrow();

    // Prevent afterEach from double-closing
    client = undefined;
  });
});
