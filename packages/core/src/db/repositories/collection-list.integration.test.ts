// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { DatabaseClient } from "../client.js";
import { openFixture } from "../testing/open-fixture.js";
import { CollectionListRepository } from "./collection-list.js";

describe("CollectionListRepository (integration)", () => {
  let rawDb: DatabaseSync;
  let client: DatabaseClient;
  let repo: CollectionListRepository;

  beforeAll(() => {
    // Use openFixture() for an isolated writable copy
    rawDb = openFixture();
    client = { db: rawDb, close: () => rawDb.close() } as unknown as DatabaseClient;
    repo = new CollectionListRepository(client);
  });

  afterAll(() => {
    rawDb.close();
  });

  describe("listCollections", () => {
    it("returns named collections with people counts from fixture", () => {
      const collections = repo.listCollections();

      // Fixture has 3 named collections (id 10, 11, 12)
      // Exclude-list collections (id 1-6, name NULL) are filtered out
      expect(collections.length).toBeGreaterThanOrEqual(3);

      const prospects = collections.find((c) => c.name === "Prospects") as (typeof collections)[number];
      expect(prospects).toBeDefined();
      expect(prospects.peopleCount).toBe(2);

      const clients = collections.find((c) => c.name === "Clients") as (typeof collections)[number];
      expect(clients).toBeDefined();
      expect(clients.peopleCount).toBe(1);

      const emptyList = collections.find((c) => c.name === "Empty List") as (typeof collections)[number];
      expect(emptyList).toBeDefined();
      expect(emptyList.peopleCount).toBe(0);
    });

    it("excludes unnamed collections (exclude lists)", () => {
      const collections = repo.listCollections();

      // No collection should have a null name
      for (const c of collections) {
        expect(c.name).not.toBeNull();
        expect(c.name.length).toBeGreaterThan(0);
      }
    });
  });

  describe("createCollection", () => {
    it("creates a new named collection and returns its ID", () => {
      const id = repo.createCollection(1, "Integration Test List");
      expect(id).toBeGreaterThan(0);

      // Verify it appears in listCollections
      const collections = repo.listCollections();
      const created = collections.find((c) => c.name === "Integration Test List") as (typeof collections)[number];
      expect(created).toBeDefined();
      expect(created.id).toBe(id);
      expect(created.peopleCount).toBe(0);
    });
  });

  describe("addPeople", () => {
    it("adds people to a collection", () => {
      const id = repo.createCollection(1, "Add People Test");
      const added = repo.addPeople(id, [1, 3]);
      expect(added).toBe(2);
    });

    it("returns 0 for already-present people", () => {
      const id = repo.createCollection(1, "Duplicate Test");
      repo.addPeople(id, [1]);
      const added = repo.addPeople(id, [1]);
      expect(added).toBe(0);
    });

    it("returns 0 for empty personIds", () => {
      const added = repo.addPeople(10, []);
      expect(added).toBe(0);
    });
  });

  describe("removePeople", () => {
    it("removes people from a collection", () => {
      const id = repo.createCollection(1, "Remove People Test");
      repo.addPeople(id, [1, 2, 3]);
      const removed = repo.removePeople(id, [1, 3]);
      expect(removed).toBe(2);
    });

    it("returns 0 for non-present people", () => {
      const id = repo.createCollection(1, "Remove Non-Present Test");
      const removed = repo.removePeople(id, [999]);
      expect(removed).toBe(0);
    });

    it("returns 0 for empty personIds", () => {
      const removed = repo.removePeople(10, []);
      expect(removed).toBe(0);
    });
  });

  describe("deleteCollection", () => {
    it("deletes a named collection and its people", () => {
      const id = repo.createCollection(1, "Delete Test");
      repo.addPeople(id, [1, 2]);

      const deleted = repo.deleteCollection(id);
      expect(deleted).toBe(true);

      // Verify it no longer appears
      const collections = repo.listCollections();
      expect(collections.find((c) => c.id === id)).toBeUndefined();
    });

    it("returns false for non-existent collection", () => {
      const deleted = repo.deleteCollection(99999);
      expect(deleted).toBe(false);
    });

    it("does not delete unnamed collections (exclude lists)", () => {
      // Collection 1 is an exclude list (name IS NULL)
      const deleted = repo.deleteCollection(1);
      expect(deleted).toBe(false);
    });
  });

  describe("getCollectionPeopleUrls", () => {
    it("returns LinkedIn URLs for people in collection", () => {
      // Collection 10 (Prospects) has people 1 (Ada) and 3 (Charlie)
      // Person 1 has public ID 'ada-lovelace-test'
      const urls = repo.getCollectionPeopleUrls(10);
      expect(urls.length).toBeGreaterThanOrEqual(1);

      const adaUrl = urls.find((u) => u.includes("ada-lovelace-test"));
      expect(adaUrl).toBe("https://www.linkedin.com/in/ada-lovelace-test/");
    });

    it("returns empty array for empty collection", () => {
      const urls = repo.getCollectionPeopleUrls(12);
      expect(urls).toEqual([]);
    });
  });
});
