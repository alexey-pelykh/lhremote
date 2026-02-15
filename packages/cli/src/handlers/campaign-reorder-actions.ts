// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  ActionNotFoundError,
  CampaignExecutionError,
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  InstanceNotRunningError,
  campaignReorderActions,
  type CampaignReorderActionsOutput,
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

  let result: CampaignReorderActionsOutput;
  try {
    result = await campaignReorderActions({
      campaignId,
      actionIds,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
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
    return;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(
      `Actions reordered in campaign ${String(campaignId)}.\n`,
    );
    for (const action of result.actions) {
      process.stdout.write(
        `  #${action.id} "${action.name}" (${action.config.actionType})\n`,
      );
    }
  }
}
