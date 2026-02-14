// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

import {
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  DEFAULT_CDP_PORT,
  errorMessage,
  ExcludeListNotFoundError,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";

import { resolvePersonIds } from "./person-ids.js";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaign-targeting | campaign-exclude-remove} CLI command. */
export async function handleCampaignExcludeRemove(
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
      const removed = repo.removeFromExcludeList(
        campaignId,
        personIds,
        options.actionId,
      );

      const level = options.actionId !== undefined ? "action" : "campaign";
      const targetLabel =
        options.actionId !== undefined
          ? `action ${String(options.actionId)} in campaign ${String(campaignId)}`
          : `campaign ${String(campaignId)}`;

      if (options.json) {
        const response = {
          success: true,
          campaignId,
          ...(options.actionId !== undefined
            ? { actionId: options.actionId }
            : {}),
          level,
          removed,
          notInList: personIds.length - removed,
        };
        process.stdout.write(JSON.stringify(response, null, 2) + "\n");
      } else {
        process.stdout.write(
          `Removed ${String(removed)} person(s) from exclude list for ${targetLabel}.\n`,
        );
        if (personIds.length - removed > 0) {
          process.stdout.write(
            `${String(personIds.length - removed)} person(s) were not in the exclude list.\n`,
          );
        }
      }
    }, { readOnly: false });
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
  }
}
