// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  ActionNotFoundError,
  CampaignNotFoundError,
  errorMessage,
  campaignUpdateAction,
  type CampaignUpdateActionOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaign-actions | campaign-update-action} CLI command. */
export async function handleCampaignUpdateAction(
  campaignId: number,
  actionId: number,
  options: {
    name?: string;
    description?: string;
    clearDescription?: boolean;
    coolDown?: number;
    maxResults?: number;
    actionSettings?: string;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  // Parse action settings JSON if provided
  let parsedSettings: Record<string, unknown> | undefined;
  if (options.actionSettings !== undefined) {
    try {
      parsedSettings = JSON.parse(options.actionSettings) as Record<
        string,
        unknown
      >;
    } catch {
      process.stderr.write("Invalid JSON in --action-settings.\n");
      process.exitCode = 1;
      return;
    }
  }

  // Determine description value
  const description = options.clearDescription
    ? null
    : options.description;

  let result: CampaignUpdateActionOutput;
  try {
    result = await campaignUpdateAction({
      campaignId,
      actionId,
      name: options.name,
      description,
      coolDown: options.coolDown,
      maxActionResultsPerIteration: options.maxResults,
      actionSettings: parsedSettings,
      cdpPort: options.cdpPort,
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
      `Action #${result.id} "${result.name}" updated in campaign #${String(campaignId)}.\n`,
    );
  }
}
