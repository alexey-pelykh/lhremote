// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { copyFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the test fixture database file. */
export const FIXTURE_PATH = join(__dirname, "fixture.db");

/**
 * Opens the fixture database as a writable temporary copy.
 *
 * Each call returns an independent database instance so tests cannot
 * interfere with each other.  The real LinkedHelper schema (tables,
 * indexes, CHECK constraints) and synthetic mock data are included.
 *
 * Call `.close()` when done — the temporary file is deleted
 * automatically on close.
 */
export function openFixture(): DatabaseSync {
  const tmpPath = join(tmpdir(), `lhremote-fixture-${randomUUID()}.db`);
  copyFileSync(FIXTURE_PATH, tmpPath);

  const db = new DatabaseSync(tmpPath);

  // Wrap close() to also clean up the temp file
  const originalClose = db.close.bind(db);
  db.close = () => {
    originalClose();
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
  };

  return db;
}
