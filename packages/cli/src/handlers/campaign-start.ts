// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignTimeoutError,
  DEFAULT_CDP_PORT,
  errorMessage,
  InstanceNotRunningError,
  campaignStart,
  type CampaignStartOutput,
} from "@lhremote/core";

import { resolvePersonIds } from "./person-ids.js";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaigns | campaign-start} CLI command. */
export async function handleCampaignStart(
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

  let result: CampaignStartOutput;
  try {
    result = await campaignStart({
      campaignId,
      personIds,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof CampaignTimeoutError) {
      process.stderr.write(`Campaign start timed out: ${error.message}\n`);
    } else if (error instanceof CampaignExecutionError) {
      process.stderr.write(`Failed to start campaign: ${error.message}\n`);
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
    process.stdout.write(
      `Campaign ${String(campaignId)} started with ${String(result.personsQueued)} persons queued.\n`,
    );
  }
}
