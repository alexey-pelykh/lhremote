// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  ActionNotFoundError,
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  NoNextActionError,
  campaignMoveNext,
  type CampaignMoveNextOutput,
} from "@lhremote/core";

import { resolvePersonIds } from "./person-ids.js";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaign-actions | campaign-move-next} CLI command. */
export async function handleCampaignMoveNext(
  campaignId: number,
  actionId: number,
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

  let result: CampaignMoveNextOutput;
  try {
    result = await campaignMoveNext({
      campaignId,
      actionId,
      personIds,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof ActionNotFoundError) {
      process.stderr.write(
        `Action ${String(actionId)} not found in campaign ${String(campaignId)}.\n`,
      );
    } else if (error instanceof NoNextActionError) {
      process.stderr.write(
        `Action ${String(actionId)} is the last action in campaign ${String(campaignId)}.\n`,
      );
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
      `Campaign ${String(campaignId)}: ${String(result.personsMoved)} persons moved from action ${String(actionId)} to action ${String(result.toActionId)}.\n`,
    );
  }
}
