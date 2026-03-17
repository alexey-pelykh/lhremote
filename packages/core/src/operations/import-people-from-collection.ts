// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CampaignService } from "../services/campaign.js";
import { CollectionListRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import { IMPORT_CHUNK_SIZE } from "./import-people-from-urls.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the import-people-from-collection operation.
 */
export interface ImportPeopleFromCollectionInput extends ConnectionOptions {
  readonly collectionId: number;
  readonly campaignId: number;
}

/**
 * Output from the import-people-from-collection operation.
 */
export interface ImportPeopleFromCollectionOutput {
  readonly success: true;
  readonly collectionId: number;
  readonly campaignId: number;
  readonly actionId: number;
  readonly totalUrls: number;
  readonly imported: number;
  readonly alreadyInQueue: number;
  readonly alreadyProcessed: number;
  readonly failed: number;
}

/**
 * Import all people from a collection into a campaign action.
 *
 * Reads LinkedIn profile URLs from the collection's people and
 * feeds them into the campaign via `importPeopleFromUrls`.
 */
export async function importPeopleFromCollection(
  input: ImportPeopleFromCollectionInput,
): Promise<ImportPeopleFromCollectionOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    const collectionRepo = new CollectionListRepository(db);
    const linkedInUrls = collectionRepo.getCollectionPeopleUrls(
      input.collectionId,
    );

    if (linkedInUrls.length === 0) {
      return {
        success: true as const,
        collectionId: input.collectionId,
        campaignId: input.campaignId,
        actionId: 0,
        totalUrls: 0,
        imported: 0,
        alreadyInQueue: 0,
        alreadyProcessed: 0,
        failed: 0,
      };
    }

    const campaignService = new CampaignService(instance, db);

    let actionId = 0;
    let imported = 0;
    let alreadyInQueue = 0;
    let alreadyProcessed = 0;
    let failed = 0;

    for (let i = 0; i < linkedInUrls.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = linkedInUrls.slice(i, i + IMPORT_CHUNK_SIZE);
      const result = await campaignService.importPeopleFromUrls(
        input.campaignId,
        chunk,
      );
      actionId = result.actionId;
      imported += result.successful;
      alreadyInQueue += result.alreadyInQueue;
      alreadyProcessed += result.alreadyProcessed;
      failed += result.failed;
    }

    return {
      success: true as const,
      collectionId: input.collectionId,
      campaignId: input.campaignId,
      actionId,
      totalUrls: linkedInUrls.length,
      imported,
      alreadyInQueue,
      alreadyProcessed,
      failed,
    };
  });
}
