// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  CampaignExecutionError,
  CampaignNotFoundError,
  errorMessage,
  InstanceNotRunningError,
  campaignDelete,
  type CampaignDeleteOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaigns | campaign-delete} CLI command. */
export async function handleCampaignDelete(
  campaignId: number,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    hard?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: CampaignDeleteOutput;
  try {
    result = await campaignDelete({
      campaignId,
      cdpPort: options.cdpPort,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
      hard: options.hard,
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof CampaignExecutionError) {
      process.stderr.write(`Failed to delete campaign: ${error.message}\n`);
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
    const verb = result.action === "hard-deleted" ? "deleted" : "archived";
    process.stdout.write(
      `Campaign ${String(campaignId)} ${verb}.\n`,
    );
  }
}
