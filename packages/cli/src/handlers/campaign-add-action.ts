// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  campaignAddAction,
  type CampaignAddActionOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaign-actions | campaign-add-action} CLI command. */
export async function handleCampaignAddAction(
  campaignId: number,
  options: {
    name: string;
    actionType: string;
    description?: string;
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
  let parsedSettings: Record<string, unknown> = {};
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

  let result: CampaignAddActionOutput;
  try {
    result = await campaignAddAction({
      campaignId,
      name: options.name,
      actionType: options.actionType,
      description: options.description,
      coolDown: options.coolDown,
      maxActionResultsPerIteration: options.maxResults,
      actionSettings: parsedSettings,
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
      `Action added: #${result.id} "${result.name}" (${result.config.actionType}) to campaign #${String(campaignId)}\n`,
    );
  }
}
