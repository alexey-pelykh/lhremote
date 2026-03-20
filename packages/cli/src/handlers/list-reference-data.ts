// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  type ReferenceDataType,
  getLinkedInReferenceData,
  isReferenceDataType,
} from "@lhremote/core";

const VALID_DATA_TYPES: readonly ReferenceDataType[] = [
  "INDUSTRY",
  "SENIORITY",
  "FUNCTION",
  "COMPANY_SIZE",
  "CONNECTION_DEGREE",
  "PROFILE_LANGUAGE",
];

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#list-reference-data | list-reference-data} CLI command. */
export function handleListReferenceData(
  dataType: string,
  options: {
    json?: boolean;
  },
): void {
  if (!isReferenceDataType(dataType)) {
    process.stderr.write(
      `Unknown reference data type: ${dataType}\n` +
        `Valid types: ${VALID_DATA_TYPES.join(", ")}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const items = getLinkedInReferenceData(dataType);

  if (options.json) {
    process.stdout.write(
      JSON.stringify({ dataType, items }, null, 2) + "\n",
    );
    return;
  }

  process.stdout.write(`${dataType} (${String(items.length)} entries):\n\n`);

  for (const item of items) {
    // Each entry type has different key names; normalise for display
    const entries = Object.entries(item as unknown as Record<string, unknown>);
    const parts = entries.map(
      ([key, value]) => `${key}: ${String(value)}`,
    );
    process.stdout.write(`  ${parts.join(", ")}\n`);
  }
}
