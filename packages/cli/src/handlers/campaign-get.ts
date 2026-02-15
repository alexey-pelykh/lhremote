// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  campaignGet,
  type CampaignGetOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaigns | campaign-get} CLI command. */
export async function handleCampaignGet(
  campaignId: number,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: CampaignGetOutput;
  try {
    result = await campaignGet({
      campaignId,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
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
    process.stdout.write(`Campaign #${result.id}: ${result.name}\n`);
    process.stdout.write(`State: ${result.state}\n`);
    process.stdout.write(`Paused: ${result.isPaused ? "yes" : "no"}\n`);
    process.stdout.write(
      `Archived: ${result.isArchived ? "yes" : "no"}\n`,
    );
    if (result.description) {
      process.stdout.write(`Description: ${result.description}\n`);
    }
    process.stdout.write(`Created: ${result.createdAt}\n`);

    if (result.actions.length > 0) {
      process.stdout.write(`\nActions (${String(result.actions.length)}):\n`);
      for (const action of result.actions) {
        process.stdout.write(
          `  #${action.id}  ${action.name} [${action.config.actionType}]\n`,
        );
      }
    }
  }
}
