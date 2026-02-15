// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  campaignUpdate,
  type CampaignUpdateOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaigns | campaign-update} CLI command. */
export async function handleCampaignUpdate(
  campaignId: number,
  options: {
    name?: string;
    description?: string;
    clearDescription?: boolean;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  // Validate that at least one field is provided
  if (
    options.name === undefined &&
    options.description === undefined &&
    !options.clearDescription
  ) {
    process.stderr.write(
      "At least one of --name, --description, or --clear-description is required.\n",
    );
    process.exitCode = 1;
    return;
  }

  const updates: { name?: string; description?: string | null } = {};
  if (options.name !== undefined) updates.name = options.name;
  if (options.clearDescription) {
    updates.description = null;
  } else if (options.description !== undefined) {
    updates.description = options.description;
  }

  let result: CampaignUpdateOutput;
  try {
    result = await campaignUpdate({
      campaignId,
      updates,
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
    process.stdout.write(
      `Campaign updated: #${result.id} "${result.name}"\n`,
    );
  }
}
