// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  DEFAULT_CDP_PORT,
  errorMessage,
  NoNextActionError,
  resolveAccount,
  withDatabase,
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
      const { nextActionId } = repo.moveToNextAction(
        campaignId,
        actionId,
        personIds,
      );

      if (options.json) {
        const response = {
          success: true,
          campaignId,
          fromActionId: actionId,
          toActionId: nextActionId,
          personsMoved: personIds.length,
        };
        process.stdout.write(JSON.stringify(response, null, 2) + "\n");
      } else {
        process.stdout.write(
          `Campaign ${String(campaignId)}: ${String(personIds.length)} persons moved from action ${String(actionId)} to action ${String(nextActionId)}.\n`,
        );
      }
    }, { readOnly: false });
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
  }
}
