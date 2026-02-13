// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  ActionNotFoundError,
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  DEFAULT_CDP_PORT,
  errorMessage,
  InstanceNotRunningError,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaign-actions | campaign-reorder-actions} CLI command. */
export async function handleCampaignReorderActions(
  campaignId: number,
  options: {
    actionIds: string;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  const cdpPort = options.cdpPort ?? DEFAULT_CDP_PORT;

  // Parse action IDs
  const actionIds = options.actionIds
    .split(",")
    .map((s) => {
      const n = Number(s.trim());
      if (!Number.isInteger(n) || n <= 0) {
        process.stderr.write(
          `Invalid action ID: "${s.trim()}". Expected positive integers.\n`,
        );
        process.exitCode = 1;
        return NaN;
      }
      return n;
    });

  if (actionIds.some((n) => Number.isNaN(n))) {
    return;
  }

  if (actionIds.length === 0) {
    process.stderr.write("No action IDs provided.\n");
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
    await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
      const campaignService = new CampaignService(instance, db);
      const updatedActions = await campaignService.reorderActions(
        campaignId,
        actionIds,
      );

      if (options.json) {
        const response = {
          success: true,
          campaignId,
          actions: updatedActions,
        };
        process.stdout.write(JSON.stringify(response, null, 2) + "\n");
      } else {
        process.stdout.write(
          `Actions reordered in campaign ${String(campaignId)}.\n`,
        );
        for (const action of updatedActions) {
          process.stdout.write(
            `  #${action.id} "${action.name}" (${action.config.actionType})\n`,
          );
        }
      }
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof ActionNotFoundError) {
      process.stderr.write(
        `One or more action IDs not found in campaign ${String(campaignId)}.\n`,
      );
    } else if (error instanceof CampaignExecutionError) {
      process.stderr.write(
        `Failed to reorder actions: ${error.message}\n`,
      );
    } else if (error instanceof InstanceNotRunningError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  }
}
