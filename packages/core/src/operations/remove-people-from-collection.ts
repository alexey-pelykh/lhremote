// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CollectionListRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the remove-people-from-collection operation.
 */
export interface RemovePeopleFromCollectionInput extends ConnectionOptions {
  readonly collectionId: number;
  readonly personIds: number[];
}

/**
 * Output from the remove-people-from-collection operation.
 */
export interface RemovePeopleFromCollectionOutput {
  readonly success: true;
  readonly collectionId: number;
  readonly removed: number;
}

/**
 * Remove people from a collection by person IDs.
 */
export async function removePeopleFromCollection(
  input: RemovePeopleFromCollectionInput,
): Promise<RemovePeopleFromCollectionOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const repo = new CollectionListRepository(db);
    const removed = repo.removePeople(input.collectionId, input.personIds);
    return {
      success: true as const,
      collectionId: input.collectionId,
      removed,
    };
  }, { readOnly: false });
}
