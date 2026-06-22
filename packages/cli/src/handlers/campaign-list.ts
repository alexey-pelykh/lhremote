// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { campaignList, errorMessage, InstanceNotRunningError } from "@insoftex/lhremote-core";

/** Handle the {@link https://github.com/insoftex-company/insoftex-lhremote#campaigns | campaign-list} CLI command. */
export async function handleCampaignList(options: {
  includeArchived?: boolean;
  cdpPort?: number;
  cdpHost?: string;
  allowRemote?: boolean;
  accountId?: number;
  json?: boolean;
}): Promise<void> {
  const { includeArchived = false } = options;

  let result: Awaited<ReturnType<typeof campaignList>>;
  try {
    result = await campaignList({
      includeArchived,
      cdpPort: options.cdpPort,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
      accountId: options.accountId,
    });
  } catch (error) {
    if (error instanceof InstanceNotRunningError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const { campaigns } = result;

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (campaigns.length === 0) {
      process.stdout.write("No campaigns found.\n");
      return;
    }

    process.stdout.write(`Campaigns (${String(campaigns.length)} total):\n\n`);

    for (const campaign of campaigns) {
      const parts: string[] = [`#${campaign.id}  ${campaign.name}`];
      parts.push(`[${campaign.state}]`);
      parts.push(`${String(campaign.actionCount)} actions`);
      if (campaign.description) {
        parts.push(campaign.description);
      }
      process.stdout.write(`${parts.join(" — ")}\n`);
    }
  }
}
