// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  CampaignExecutionError,
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  InstanceNotRunningError,
  campaignStatus,
  type CampaignStatusOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaigns | campaign-status} CLI command. */
export async function handleCampaignStatus(
  campaignId: number,
  options: {
    includeResults?: boolean;
    limit?: number;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: CampaignStatusOutput;
  try {
    result = await campaignStatus({
      campaignId,
      includeResults: options.includeResults,
      limit: options.limit,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof CampaignExecutionError) {
      process.stderr.write(
        `Failed to get campaign status: ${error.message}\n`,
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
    process.stdout.write(`Campaign #${String(campaignId)} Status\n`);
    process.stdout.write(`State: ${result.campaignState}\n`);
    process.stdout.write(`Paused: ${result.isPaused ? "yes" : "no"}\n`);
    process.stdout.write(`Runner: ${result.runnerState}\n`);

    if (result.actionCounts.length > 0) {
      process.stdout.write("\nAction Counts:\n");
      for (const ac of result.actionCounts) {
        process.stdout.write(
          `  Action #${String(ac.actionId)}: ${String(ac.queued)} queued, ${String(ac.processed)} processed, ${String(ac.successful)} successful, ${String(ac.failed)} failed\n`,
        );
      }
    }

    if (options.includeResults) {
      const results = result.results ?? [];
      if (results.length > 0) {
        process.stdout.write(`\nResults (${String(results.length)}):\n`);
        for (const r of results) {
          process.stdout.write(
            `  Person ${String(r.personId)}: result=${String(r.result)} (action version #${String(r.actionVersionId)})\n`,
          );
        }
      } else {
        process.stdout.write("\nNo results yet.\n");
      }
    }
  }
}
