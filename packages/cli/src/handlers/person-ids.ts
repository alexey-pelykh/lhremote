// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { readFileSync } from "node:fs";

export function parsePersonIds(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Invalid person ID: "${s}"`);
      }
      return n;
    });
}

export function readPersonIdsFile(filePath: string): number[] {
  const content = readFileSync(filePath, "utf-8");
  return content
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Invalid person ID in file: "${s}"`);
      }
      return n;
    });
}

export function resolvePersonIds(options: {
  personIds?: string;
  personIdsFile?: string;
}): number[] {
  if (options.personIds && options.personIdsFile) {
    throw new Error("Use only one of --person-ids or --person-ids-file.");
  }

  let personIds: number[];
  if (options.personIds) {
    personIds = parsePersonIds(options.personIds);
  } else if (options.personIdsFile) {
    personIds = readPersonIdsFile(options.personIdsFile);
  } else {
    throw new Error("Either --person-ids or --person-ids-file is required.");
  }

  if (personIds.length === 0) {
    throw new Error("No person IDs provided.");
  }

  return personIds;
}
