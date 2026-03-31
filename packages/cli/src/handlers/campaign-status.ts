// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  CampaignExecutionError,
  CampaignNotFoundError,
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
      cdpPort: options.cdpPort,
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
          let line = `  Person ${String(r.personId)}`;
          if (r.profile) {
            const name = [r.profile.firstName, r.profile.lastName]
              .filter(Boolean)
              .join(" ");
            if (name) line += ` (${name})`;
          }
          line += `: result=${String(r.result)} (action version #${String(r.actionVersionId)})`;
          if (r.profile) {
            const details: string[] = [];
            if (r.profile.title) details.push(r.profile.title);
            if (r.profile.company) details.push(`at ${r.profile.company}`);
            if (details.length > 0) line += `\n    ${details.join(" ")}`;
          }
          process.stdout.write(line + "\n");
        }
      } else {
        process.stdout.write("\nNo results yet.\n");
      }
    }
  }
}
