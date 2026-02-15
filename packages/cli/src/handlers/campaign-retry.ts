// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  campaignRetry,
  type CampaignRetryOutput,
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
  let personIds: number[];
  try {
    personIds = resolvePersonIds(options);
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  let result: CampaignRetryOutput;
  try {
    result = await campaignRetry({
      campaignId,
      personIds,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
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
    process.stdout.write(
      `Campaign ${String(campaignId)}: ${String(result.personsReset)} persons reset for retry.\n`,
    );
  }
}
