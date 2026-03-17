// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { readFileSync } from "node:fs";

import {
  DEFAULT_CDP_PORT,
  removePeopleFromCollection,
  errorMessage,
} from "@lhremote/core";

function parsePersonIds(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

function readPersonIdsFile(filePath: string): number[] {
  const content = readFileSync(filePath, "utf-8");
  return content
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#remove-people-from-collection | remove-people-from-collection} CLI command. */
export async function handleRemovePeopleFromCollection(
  collectionId: number,
  options: {
    personIds?: string;
    personIdsFile?: string;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  if (options.personIds && options.personIdsFile) {
    process.stderr.write("Use only one of --person-ids or --person-ids-file.\n");
    process.exitCode = 1;
    return;
  }

  let personIds: number[];
  if (options.personIds) {
    personIds = parsePersonIds(options.personIds);
  } else if (options.personIdsFile) {
    try {
      personIds = readPersonIdsFile(options.personIdsFile);
    } catch (error) {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    }
  } else {
    process.stderr.write("Either --person-ids or --person-ids-file is required.\n");
    process.exitCode = 1;
    return;
  }

  if (personIds.length === 0) {
    process.stderr.write("No valid person IDs provided.\n");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await removePeopleFromCollection({
      collectionId,
      personIds,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });

    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(
        `Removed ${String(result.removed)} people from collection #${String(collectionId)}.\n`,
      );
    }
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
