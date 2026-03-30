// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CollectionListRepository } from "../db/index.js";
import { buildCdpOptions, type ConnectionOptions } from "./types.js";

/**
 * Input for the add-people-to-collection operation.
 */
export interface AddPeopleToCollectionInput extends ConnectionOptions {
  readonly collectionId: number;
  readonly personIds: number[];
}

/**
 * Output from the add-people-to-collection operation.
 */
export interface AddPeopleToCollectionOutput {
  readonly success: true;
  readonly collectionId: number;
  readonly added: number;
  readonly alreadyInCollection: number;
}

/**
 * Add people to a collection by person IDs.
 */
export async function addPeopleToCollection(
  input: AddPeopleToCollectionInput,
): Promise<AddPeopleToCollectionOutput> {
  const cdpPort = input.cdpPort;

  const accountId = await resolveAccount(cdpPort, buildCdpOptions(input));

  return withDatabase(accountId, ({ db }) => {
    const repo = new CollectionListRepository(db);
    const added = repo.addPeople(input.collectionId, input.personIds);
    return {
      success: true as const,
      collectionId: input.collectionId,
      added,
      alreadyInCollection: input.personIds.length - added,
    };
  }, { readOnly: false });
}
