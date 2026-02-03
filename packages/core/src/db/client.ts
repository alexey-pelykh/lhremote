import Database from "better-sqlite3";

/**
 * Read-only SQLite client for querying a LinkedHelper database.
 *
 * Opens the database in read-only mode. LinkedHelper uses WAL
 * journaling, so concurrent reads do not block writes.
 */
export class DatabaseClient {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true });
  }

  close(): void {
    this.db.close();
  }
}
