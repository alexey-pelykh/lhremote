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
  }

  close(): void {
    this.db.close();
  }
}
