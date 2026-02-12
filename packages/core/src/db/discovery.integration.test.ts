// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { DatabaseClient } from "./client.js";
import { DatabaseNotFoundError } from "./errors.js";
import { discoverAllDatabases, discoverDatabase } from "./discovery.js";
import { FIXTURE_PATH } from "./testing/open-fixture.js";

// Mock only homedir — all other node:fs/node:os calls stay real.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn(actual.homedir) };
});

const mockedHomedir = vi.mocked(homedir);

describe("discovery (integration)", () => {
  const tmpBase = join(
    tmpdir(),
    `lhremote-discovery-int-${Date.now().toString(36)}`,
  );
  const fakeHome = tmpBase;
  // Linux layout: ~/.config/linked-helper/Partitions/...
  const partitionsDir = join(
    fakeHome,
    ".config",
    "linked-helper",
    "Partitions",
  );

  let dbPath111: string;
  let dbPath222: string;

  function createPartition(accountId: number): string {
    const dir = join(
      partitionsDir,
      `linked-helper-account-${String(accountId)}-main`,
    );
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "lh.db");
    copyFileSync(FIXTURE_PATH, dbPath);
    return dbPath;
  }

  beforeAll(() => {
    mkdirSync(partitionsDir, { recursive: true });
    dbPath111 = createPartition(111);
    dbPath222 = createPartition(222);

    // Account 333: partition directory exists but no lh.db inside
    mkdirSync(
      join(partitionsDir, "linked-helper-account-333-main"),
      { recursive: true },
    );

    // Non-matching directories that should be ignored
    mkdirSync(join(partitionsDir, "some-unrelated-dir"), { recursive: true });

    vi.stubGlobal("process", { ...process, platform: "linux" });
    mockedHomedir.mockReturnValue(fakeHome);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    rmSync(tmpBase, { recursive: true, force: true });
  });

  describe("discoverDatabase", () => {
    it("returns the path for an existing account", () => {
      const result = discoverDatabase(111);
      expect(result).toBe(dbPath111);
    });

    it("returns the path for another existing account", () => {
      const result = discoverDatabase(222);
      expect(result).toBe(dbPath222);
    });

    it("throws DatabaseNotFoundError for a nonexistent account", () => {
      expect(() => discoverDatabase(999)).toThrow(DatabaseNotFoundError);
    });

    it("throws DatabaseNotFoundError when partition exists but db file is missing", () => {
      expect(() => discoverDatabase(333)).toThrow(DatabaseNotFoundError);
    });

    it("discovered database can be opened by DatabaseClient", () => {
      const path = discoverDatabase(111);
      const client = new DatabaseClient(path);
      const row = client.db
        .prepare(
          "SELECT first_name FROM person_mini_profile WHERE person_id = 1",
        )
        .get() as { first_name: string } | undefined;
      expect(row?.first_name).toBe("Ada");
      client.close();
    });
  });

  describe("discoverAllDatabases", () => {
    it("finds all accounts with database files", () => {
      const result = discoverAllDatabases();

      expect(result.size).toBe(2);
      expect(result.get(111)).toBe(dbPath111);
      expect(result.get(222)).toBe(dbPath222);
    });

    it("excludes partitions where db file is missing", () => {
      const result = discoverAllDatabases();
      expect(result.has(333)).toBe(false);
    });

    it("excludes non-partition directories", () => {
      const result = discoverAllDatabases();
      // Only 111 and 222, not "some-unrelated-dir"
      expect(result.size).toBe(2);
    });

    it("all discovered paths are openable by DatabaseClient", () => {
      const result = discoverAllDatabases();

      for (const [, path] of result) {
        const client = new DatabaseClient(path);
        const row = client.db
          .prepare("SELECT COUNT(*) AS cnt FROM people")
          .get() as { cnt: number };
        expect(row.cnt).toBeGreaterThan(0);
        client.close();
      }
    });
  });
});
