// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  ActionNotFoundError,
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  ExcludeListNotFoundError,
  campaignExcludeAdd,
  type CampaignExcludeAddOutput,
} from "@lhremote/core";

import { resolvePersonIds } from "./person-ids.js";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaign-targeting | campaign-exclude-add} CLI command. */
export async function handleCampaignExcludeAdd(
  campaignId: number,
  options: {
    personIds?: string;
    personIdsFile?: string;
    actionId?: number;
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

  let result: CampaignExcludeAddOutput;
  try {
    result = await campaignExcludeAdd({
      campaignId,
      personIds,
      actionId: options.actionId,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof ActionNotFoundError) {
      process.stderr.write(
        `Action ${String(options.actionId)} not found in campaign ${String(campaignId)}.\n`,
      );
    } else if (error instanceof ExcludeListNotFoundError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const targetLabel =
    options.actionId !== undefined
      ? `action ${String(options.actionId)} in campaign ${String(campaignId)}`
      : `campaign ${String(campaignId)}`;

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(
      `Added ${String(result.added)} person(s) to exclude list for ${targetLabel}.\n`,
    );
    if (result.alreadyExcluded > 0) {
      process.stdout.write(
        `${String(result.alreadyExcluded)} person(s) already in exclude list.\n`,
      );
    }
  }
}
