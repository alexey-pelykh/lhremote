// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  CampaignNotFoundError,
  CampaignRepository,
  DEFAULT_CDP_PORT,
  errorMessage,
  resolveAccount,
  withDatabase,
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
  const cdpPort = options.cdpPort ?? DEFAULT_CDP_PORT;

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
      const updates: { name?: string; description?: string | null } = {};
      if (options.name !== undefined) updates.name = options.name;
      if (options.clearDescription) {
        updates.description = null;
      } else if (options.description !== undefined) {
        updates.description = options.description;
      }

      const campaign = repo.updateCampaign(campaignId, updates);

      if (options.json) {
        process.stdout.write(JSON.stringify(campaign, null, 2) + "\n");
      } else {
        process.stdout.write(
          `Campaign updated: #${campaign.id} "${campaign.name}"\n`,
        );
      }
    }, { readOnly: false });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  }
}
