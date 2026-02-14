// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

import {
  CampaignNotFoundError,
  CampaignRepository,
  DEFAULT_CDP_PORT,
  errorMessage,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";

import { resolvePersonIds } from "./person-ids.js";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaigns | campaign-retry} CLI command. */
export async function handleCampaignRetry(
  campaignId: number,
  options: {
    personIds?: string;
    personIdsFile?: string;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  const cdpPort = options.cdpPort ?? DEFAULT_CDP_PORT;

  let personIds: number[];
  try {
    personIds = resolvePersonIds(options);
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  let accountId: number;
  try {
    accountId = await resolveAccount(cdpPort, {
      ...(options.cdpHost !== undefined && { host: options.cdpHost }),
      ...(options.allowRemote !== undefined && { allowRemote: options.allowRemote }),
    });
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    await withDatabase(accountId, ({ db }) => {
      const repo = new CampaignRepository(db);
      repo.resetForRerun(campaignId, personIds);

      if (options.json) {
        const response = {
          success: true,
          campaignId,
          personsReset: personIds.length,
          message:
            "Persons reset for retry. Use campaign-start to run the campaign.",
        };
        process.stdout.write(JSON.stringify(response, null, 2) + "\n");
      } else {
        process.stdout.write(
          `Campaign ${String(campaignId)}: ${String(personIds.length)} persons reset for retry.\n`,
        );
      }
    }, { readOnly: false });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  }
}
