// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  ActionNotFoundError,
  CampaignExecutionError,
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  InstanceNotRunningError,
  campaignRemoveAction,
  type CampaignRemoveActionOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaign-actions | campaign-remove-action} CLI command. */
export async function handleCampaignRemoveAction(
  campaignId: number,
  actionId: number,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: CampaignRemoveActionOutput;
  try {
    result = await campaignRemoveAction({
      campaignId,
      actionId,
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
    } else if (error instanceof CampaignExecutionError) {
      process.stderr.write(`Failed to remove action: ${error.message}\n`);
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
      `Action ${String(actionId)} removed from campaign ${String(campaignId)}.\n`,
    );
  }
}
