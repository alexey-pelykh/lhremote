// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { DatabaseClient } from "../client.js";

type PreparedStatement = ReturnType<
  import("node:sqlite").DatabaseSync["prepare"]
>;

/**
 * Summary of a named collection (LH "List").
 */
export interface CollectionSummary {
  readonly id: number;
  readonly name: string;
  readonly peopleCount: number;
  readonly createdAt: string;
}

/**
 * Repository for LinkedHelper Lists (collections) CRUD operations.
 *
 * Named collections are user-visible lists managed via the LH
 * `ListsManager` UI.  Exclude-list collections (name IS NULL) are
 * filtered out automatically.
 *
 * Write operations require the DatabaseClient to be opened with
 * `{ readOnly: false }`.
 */
export class CollectionListRepository {
  private readonly stmtListCollections;

  // Write statements (prepared lazily to avoid issues with read-only mode)
  private writeStatements: {
    insertCollection: PreparedStatement;
    insertCollectionPeopleVersion: PreparedStatement | null;
    deleteCollectionPeopleVersionsLogs: PreparedStatement | null;
    deleteCollectionPeopleVersions: PreparedStatement | null;
    deleteCollectionPeople: PreparedStatement;
    deleteCollection: PreparedStatement;
    insertCollectionPerson: PreparedStatement;
    deleteCollectionPerson: PreparedStatement;
  } | null = null;

  constructor(private readonly client: DatabaseClient) {
    const { db } = client;

    this.stmtListCollections = db.prepare(
      `SELECT c.id, c.name,
              COUNT(cp.person_id) AS people_count,
              c.created_at
       FROM collections c
       LEFT JOIN collection_people cp ON cp.collection_id = c.id
       WHERE c.name IS NOT NULL
       GROUP BY c.id
       ORDER BY c.id`,
    );
  }

  /**
   * Resolve the external account ID to the internal `li_accounts.id`.
   *
   * The external ID corresponds to the partition-level account
   * identifier used by the launcher and database discovery.  The
   * internal ID is what the `collections` foreign key references.
   *
   * @returns The internal `li_accounts.id`, or the input value if the
   *          `li_accounts` table does not exist (test fixtures).
   */
  resolveInternalAccountId(externalAccountId: number): number {
    try {
      const row = this.client.db
        .prepare("SELECT id FROM li_accounts WHERE external_id = ?")
        .get(externalAccountId) as { id: number } | undefined;
      if (row) return row.id;
      throw new Error(
        `No li_accounts mapping found for external account ID ${externalAccountId}`,
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("no such table")) {
        return externalAccountId;
      }
      throw error;
    }
  }

  /**
   * List all named collections with people counts.
   */
  listCollections(): CollectionSummary[] {
    const rows = this.stmtListCollections.all() as unknown as {
      id: number;
      name: string;
      people_count: number;
      created_at: string;
    }[];

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      peopleCount: r.people_count,
      createdAt: r.created_at,
    }));
  }

  /**
   * Create a new named collection.
   *
   * @returns The ID of the newly created collection.
   */
  createCollection(accountId: number, name: string): number {
    const stmts = this.getWriteStatements();

    this.client.db.exec("BEGIN");
    try {
      const result = stmts.insertCollection.run(accountId, name);
      const collectionId = Number(result.lastInsertRowid);
      if (stmts.insertCollectionPeopleVersion) {
        stmts.insertCollectionPeopleVersion.run(collectionId);
      }
      this.client.db.exec("COMMIT");
      return collectionId;
    } catch (e) {
      this.client.db.exec("ROLLBACK");
      throw e;
    }
  }

  /**
   * Delete a collection and all its people associations.
   *
   * @returns `true` if the collection existed and was deleted.
   */
  deleteCollection(collectionId: number): boolean {
    const stmts = this.getWriteStatements();

    // Only delete named collections; exclude lists (name IS NULL) are skipped.
    const row = this.client.db
      .prepare("SELECT name FROM collections WHERE id = ? AND name IS NOT NULL")
      .get(collectionId) as { name: string } | undefined;
    if (!row) return false;

    this.client.db.exec("BEGIN");
    try {
      stmts.deleteCollectionPeople.run(collectionId);
      if (stmts.deleteCollectionPeopleVersionsLogs) {
        try {
          stmts.deleteCollectionPeopleVersionsLogs.run(collectionId);
        } catch (err: unknown) {
          // FK violation expected when logs reference still-needed versions; rethrow anything else
          if (!(err instanceof Error) || !err.message.includes("constraint")) throw err;
        }
      }
      if (stmts.deleteCollectionPeopleVersions) {
        try {
          stmts.deleteCollectionPeopleVersions.run(collectionId);
        } catch (err: unknown) {
          // FK violation expected when campaign/action versions still reference these entries
          if (!(err instanceof Error) || !err.message.includes("constraint")) throw err;
        }
      }
      const result = stmts.deleteCollection.run(collectionId);
      this.client.db.exec("COMMIT");
      return result.changes > 0;
    } catch (e) {
      this.client.db.exec("ROLLBACK");
      throw e;
    }
  }

  /**
   * Add people to a collection.
   *
   * @returns Number of people actually added (excludes already-present).
   */
  addPeople(collectionId: number, personIds: number[]): number {
    if (personIds.length === 0) return 0;

    const stmts = this.getWriteStatements();
    let added = 0;

    this.client.db.exec("BEGIN");
    try {
      for (const personId of personIds) {
        const result = stmts.insertCollectionPerson.run(
          collectionId,
          personId,
        );
        if (result.changes > 0) added++;
      }
      this.client.db.exec("COMMIT");
    } catch (e) {
      this.client.db.exec("ROLLBACK");
      throw e;
    }

    return added;
  }

  /**
   * Remove people from a collection.
   *
   * @returns Number of people actually removed.
   */
  removePeople(collectionId: number, personIds: number[]): number {
    if (personIds.length === 0) return 0;

    const stmts = this.getWriteStatements();
    let removed = 0;

    this.client.db.exec("BEGIN");
    try {
      for (const personId of personIds) {
        const result = stmts.deleteCollectionPerson.run(
          collectionId,
          personId,
        );
        if (result.changes > 0) removed++;
      }
      this.client.db.exec("COMMIT");
    } catch (e) {
      this.client.db.exec("ROLLBACK");
      throw e;
    }

    return removed;
  }

  /**
   * Get LinkedIn profile URLs for all people in a collection.
   *
   * Reads person IDs from `collection_people` and resolves their
   * LinkedIn public IDs from `person_external_ids`.
   *
   * @returns Array of LinkedIn profile URLs.
   */
  getCollectionPeopleUrls(collectionId: number): string[] {
    const rows = this.client.db
      .prepare(
        `SELECT pei.external_id
         FROM collection_people cp
         JOIN person_external_ids pei
           ON pei.person_id = cp.person_id AND pei.type_group = 'public'
         WHERE cp.collection_id = ?
         ORDER BY cp.person_id`,
      )
      .all(collectionId) as unknown as { external_id: string }[];

    return rows.map(
      (r) => `https://www.linkedin.com/in/${r.external_id}/`,
    );
  }

  /**
   * Prepare write statements lazily (only when needed).
   * This avoids issues when the client is opened in read-only mode.
   */
  private getWriteStatements(): typeof this.writeStatements & object {
    if (this.writeStatements) return this.writeStatements;

    const { db } = this.client;

    let insertCollectionPeopleVersion: PreparedStatement | null = null;
    try {
      insertCollectionPeopleVersion = db.prepare(
        `INSERT INTO collection_people_versions
           (collection_id, version_operation_status, created_at, updated_at)
         VALUES (?, 'addToTarget', datetime('now'), datetime('now'))`,
      );
    } catch {
      // Table may not exist in older schemas
    }

    let deleteCollectionPeopleVersionsLogs: PreparedStatement | null = null;
    try {
      deleteCollectionPeopleVersionsLogs = db.prepare(
        `DELETE FROM collection_people_versions_logs WHERE collection_id = ?`,
      );
    } catch {
      // Table may not exist in older schemas
    }

    let deleteCollectionPeopleVersions: PreparedStatement | null = null;
    try {
      deleteCollectionPeopleVersions = db.prepare(
        `DELETE FROM collection_people_versions WHERE collection_id = ?`,
      );
    } catch {
      // Table may not exist in older schemas
    }

    this.writeStatements = {
      insertCollection: db.prepare(
        `INSERT INTO collections (li_account_id, name, created_at, updated_at)
         VALUES (?, ?, datetime('now'), datetime('now'))`,
      ),
      insertCollectionPeopleVersion,
      deleteCollectionPeopleVersionsLogs,
      deleteCollectionPeopleVersions,
      deleteCollectionPeople: db.prepare(
        `DELETE FROM collection_people WHERE collection_id = ?`,
      ),
      deleteCollection: db.prepare(
        `DELETE FROM collections WHERE id = ? AND name IS NOT NULL`,
      ),
      insertCollectionPerson: db.prepare(
        `INSERT OR IGNORE INTO collection_people (collection_id, person_id)
         VALUES (?, ?)`,
      ),
      deleteCollectionPerson: db.prepare(
        `DELETE FROM collection_people
         WHERE collection_id = ? AND person_id = ?`,
      ),
    };

    return this.writeStatements;
  }
}
