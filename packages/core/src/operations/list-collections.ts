// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { CollectionSummary } from "../db/repositories/collection-list.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CollectionListRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the list-collections operation.
 */
export type ListCollectionsInput = ConnectionOptions;

/**
 * Output from the list-collections operation.
 */
export interface ListCollectionsOutput {
  readonly collections: CollectionSummary[];
  readonly total: number;
}

/**
 * List all named collections (LH Lists) with people counts.
 */
export async function listCollections(
  input: ListCollectionsInput,
): Promise<ListCollectionsOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const repo = new CollectionListRepository(db);
    const collections = repo.listCollections();
    return { collections, total: collections.length };
  });
}
