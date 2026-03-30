// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CollectionListRepository } from "../db/index.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the delete-collection operation.
 */
export interface DeleteCollectionInput extends ConnectionOptions {
  readonly collectionId: number;
}

/**
 * Output from the delete-collection operation.
 */
export interface DeleteCollectionOutput {
  readonly success: true;
  readonly collectionId: number;
  readonly deleted: boolean;
}

/**
 * Delete a collection and all its people associations.
 */
export async function deleteCollection(
  input: DeleteCollectionInput,
): Promise<DeleteCollectionOutput> {
  const cdpPort = input.cdpPort;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const repo = new CollectionListRepository(db);
    const deleted = repo.deleteCollection(input.collectionId);
    return {
      success: true as const,
      collectionId: input.collectionId,
      deleted,
    };
  }, { readOnly: false });
}
