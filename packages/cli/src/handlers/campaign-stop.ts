// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  CampaignExecutionError,
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  InstanceNotRunningError,
  campaignStop,
  type CampaignStopOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaigns | campaign-stop} CLI command. */
export async function handleCampaignStop(
  campaignId: number,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: CampaignStopOutput;
  try {
    result = await campaignStop({
      campaignId,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof CampaignExecutionError) {
      process.stderr.write(`Failed to stop campaign: ${error.message}\n`);
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
    process.stdout.write(`Campaign ${String(campaignId)} paused.\n`);
  }
}
