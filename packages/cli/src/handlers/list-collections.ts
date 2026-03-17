// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  type CollectionSummary,
  CollectionListRepository,
  DatabaseClient,
  discoverAllDatabases,
  errorMessage,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#list-collections | list-collections} CLI command. */
export async function handleListCollections(options: {
  json?: boolean;
}): Promise<void> {
  const databases = discoverAllDatabases();
  if (databases.size === 0) {
    process.stderr.write("No LinkedHelper databases found.\n");
    process.exitCode = 1;
    return;
  }

  const allCollections: CollectionSummary[] = [];

  for (const [, dbPath] of databases) {
    const db = new DatabaseClient(dbPath);
    try {
      const repo = new CollectionListRepository(db);
      const collections = repo.listCollections();
      allCollections.push(...collections);
    } catch (error) {
      const message = errorMessage(error);
      process.stderr.write(`Error in database at ${dbPath}: ${message}\n`);
      process.exitCode = 1;
      return;
    } finally {
      db.close();
    }
  }

  if (options.json) {
    const response = {
      collections: allCollections,
      total: allCollections.length,
    };
    process.stdout.write(JSON.stringify(response, null, 2) + "\n");
  } else {
    if (allCollections.length === 0) {
      process.stdout.write("No collections found.\n");
      return;
    }

    process.stdout.write(
      `Collections (${String(allCollections.length)} total):\n\n`,
    );

    for (const collection of allCollections) {
      process.stdout.write(
        `#${collection.id}  ${collection.name} — ${String(collection.peopleCount)} people\n`,
      );
    }
  }
}
