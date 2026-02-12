// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { DatabaseNotFoundError } from "./errors.js";

const PARTITION_PREFIX = "linked-helper-account-";
const PARTITION_SUFFIX = "-main";
const DB_FILENAME = "lh.db";

/**
 * Returns the platform-specific base directory where LinkedHelper
 * stores its per-account database partitions.
 */
function getBaseDirectory(): string {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "linked-helper");
    case "win32":
      return join(
        process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"),
        "linked-helper",
      );
    default:
      // Linux and other POSIX
      return join(homedir(), ".config", "linked-helper");
  }
}

/**
 * Builds the expected database path for a specific account.
 */
function buildDbPath(baseDir: string, accountId: number): string {
  const partition = `${PARTITION_PREFIX}${String(accountId)}${PARTITION_SUFFIX}`;
  return join(baseDir, "Partitions", partition, DB_FILENAME);
}

/**
 * Resolves the database file path for a LinkedHelper account.
 *
 * @throws {DatabaseNotFoundError} if the database file does not exist.
 */
export function discoverDatabase(accountId: number): string {
  const dbPath = buildDbPath(getBaseDirectory(), accountId);
  if (!existsSync(dbPath)) {
    throw new DatabaseNotFoundError(accountId);
  }
  return dbPath;
}

/**
 * Scans the LinkedHelper partitions directory and returns a map of
 * every account ID to its database file path.
 *
 * Only accounts whose database file actually exists are included.
 */
export function discoverAllDatabases(): Map<number, string> {
  const baseDir = getBaseDirectory();
  const partitionsDir = join(baseDir, "Partitions");

  const result = new Map<number, string>();

  if (!existsSync(partitionsDir)) {
    return result;
  }

  const entries = readdirSync(partitionsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(PARTITION_PREFIX)) continue;
    if (!entry.name.endsWith(PARTITION_SUFFIX)) continue;

    const idStr = entry.name.slice(
      PARTITION_PREFIX.length,
      -PARTITION_SUFFIX.length,
    );
    const accountId = Number(idStr);
    if (!Number.isInteger(accountId)) continue;

    const dbPath = join(partitionsDir, entry.name, DB_FILENAME);
    if (existsSync(dbPath)) {
      result.set(accountId, dbPath);
    }
  }

  return result;
}
