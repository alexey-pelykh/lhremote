// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CollectionListRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the create-collection operation.
 */
export interface CreateCollectionInput extends ConnectionOptions {
  readonly name: string;
}

/**
 * Output from the create-collection operation.
 */
export interface CreateCollectionOutput {
  readonly success: true;
  readonly collectionId: number;
  readonly name: string;
}

/**
 * Create a new named collection (LH List).
 */
export async function createCollection(
  input: CreateCollectionInput,
): Promise<CreateCollectionOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ accountId: acctId, db }) => {
    const repo = new CollectionListRepository(db);
    const collectionId = repo.createCollection(acctId, input.name);
    return {
      success: true as const,
      collectionId,
      name: input.name,
    };
  }, { readOnly: false });
}
