// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { DatabaseSync } from "node:sqlite";

/**
 * Options for creating a DatabaseClient.
 */
export interface DatabaseClientOptions {
  /**
   * Whether to open the database in read-only mode.
   * Defaults to true. LinkedHelper uses WAL journaling,
   * so concurrent reads do not block writes.
   */
  readOnly?: boolean;
}

/**
 * SQLite client for querying a LinkedHelper database.
 *
 * By default, opens the database in read-only mode. LinkedHelper uses WAL
 * journaling, so concurrent reads do not block writes.
 *
 * Pass `{ readOnly: false }` to enable write operations (required for
 * campaign management operations like reset).
 */
export class DatabaseClient {
  readonly db: DatabaseSync;

  constructor(dbPath: string, options: DatabaseClientOptions = {}) {
    const { readOnly = true } = options;
    this.db = new DatabaseSync(dbPath, { readOnly });
    // Allow SQLite to retry internally for up to 5 seconds when the database
    // is locked by another process (e.g. the LinkedHelper campaign runner).
    this.db.exec("PRAGMA busy_timeout = 5000");
  }

  close(): void {
    this.db.close();
  }
}
