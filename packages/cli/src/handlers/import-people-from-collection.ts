// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  CampaignExecutionError,
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  InstanceNotRunningError,
  errorMessage,
  importPeopleFromCollection,
  type ImportPeopleFromCollectionOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#import-people-from-collection | import-people-from-collection} CLI command. */
export async function handleImportPeopleFromCollection(
  collectionId: number,
  campaignId: number,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: ImportPeopleFromCollectionOutput;
  try {
    result = await importPeopleFromCollection({
      collectionId,
      campaignId,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof CampaignExecutionError) {
      process.stderr.write(
        `Failed to import people: ${error.message}\n`,
      );
    } else if (error instanceof InstanceNotRunningError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (result.totalUrls === 0) {
      process.stdout.write(
        `Collection #${String(collectionId)} has no people with LinkedIn profiles.\n`,
      );
    } else {
      process.stdout.write(
        `Imported ${String(result.imported)} people from collection #${String(collectionId)} into campaign ${String(campaignId)} action ${String(result.actionId)}.` +
          (result.alreadyInQueue > 0
            ? ` ${String(result.alreadyInQueue)} already in queue.`
            : "") +
          (result.alreadyProcessed > 0
            ? ` ${String(result.alreadyProcessed)} already processed.`
            : "") +
          (result.failed > 0
            ? ` ${String(result.failed)} failed.`
            : "") +
          "\n",
      );
    }
  }
}
