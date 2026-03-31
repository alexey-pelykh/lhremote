// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  type EntityType,
  resolveLinkedInEntity,
  errorMessage,
} from "@lhremote/core";

const VALID_ENTITY_TYPES: readonly EntityType[] = [
  "COMPANY",
  "GEO",
  "SCHOOL",
];

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#resolve-entity | resolve-entity} CLI command. */
export async function handleResolveEntity(
  entityType: string,
  query: string,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
    limit?: number;
  },
): Promise<void> {
  if (!VALID_ENTITY_TYPES.includes(entityType as EntityType)) {
    process.stderr.write(
      `Unknown entity type: ${entityType}\n` +
        `Valid types: ${VALID_ENTITY_TYPES.join(", ")}\n`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    const result = await resolveLinkedInEntity({
      query,
      entityType: entityType as EntityType,
      cdpPort: options.cdpPort,
      ...(options.cdpHost !== undefined && { cdpHost: options.cdpHost }),
      ...(options.allowRemote !== undefined && { allowRemote: options.allowRemote }),
    });

    let matches = result.matches;
    if (options.limit !== undefined) {
      matches = matches.slice(0, options.limit);
    }

    if (options.json) {
      process.stdout.write(
        JSON.stringify({ matches, strategy: result.strategy }, null, 2) + "\n",
      );
      return;
    }

    if (matches.length === 0) {
      process.stdout.write(`No matches found for "${query}"\n`);
      return;
    }

    process.stdout.write(
      `Matches for "${query}" (${entityType}, via ${result.strategy}):\n\n`,
    );
    for (const match of matches) {
      process.stdout.write(`  ${match.id}  ${match.name}  [${match.type}]\n`);
    }
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
