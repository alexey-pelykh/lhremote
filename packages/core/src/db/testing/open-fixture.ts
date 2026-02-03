import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the test fixture database file. */
export const FIXTURE_PATH = join(__dirname, "fixture.db");

/**
 * Opens the fixture database as a writable in-memory copy.
 *
 * Each call returns an independent database instance so tests cannot
 * interfere with each other.  The real LinkedHelper schema (tables,
 * indexes, CHECK constraints) and synthetic mock data are included.
 *
 * Call `.close()` when done.
 */
export function openFixture(): Database.Database {
  const buffer = readFileSync(FIXTURE_PATH);
  return new Database(buffer);
}
