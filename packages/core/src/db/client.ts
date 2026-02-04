import { DatabaseSync } from "node:sqlite";

/**
 * Read-only SQLite client for querying a LinkedHelper database.
 *
 * Opens the database in read-only mode. LinkedHelper uses WAL
 * journaling, so concurrent reads do not block writes.
 */
export class DatabaseClient {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath, { readOnly: true });
  }

  close(): void {
    this.db.close();
  }
}
