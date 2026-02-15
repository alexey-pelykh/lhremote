// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  ActionNotFoundError,
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  campaignStatistics,
  type CampaignStatisticsOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaigns | campaign-statistics} CLI command. */
export async function handleCampaignStatistics(
  campaignId: number,
  options: {
    actionId?: number;
    maxErrors?: number;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: CampaignStatisticsOutput;
  try {
    result = await campaignStatistics({
      campaignId,
      actionId: options.actionId,
      maxErrors: options.maxErrors,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof ActionNotFoundError) {
      process.stderr.write(
        `Action ${String(options.actionId)} not found in campaign ${String(campaignId)}.\n`,
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
    process.stdout.write(`Campaign #${String(campaignId)} Statistics\n`);
    process.stdout.write(
      `Totals: ${String(result.totals.successful)} successful, ` +
      `${String(result.totals.replied)} replied, ` +
      `${String(result.totals.failed)} failed, ` +
      `${String(result.totals.skipped)} skipped ` +
      `(${String(result.totals.total)} total, ` +
      `${String(result.totals.successRate)}% success rate)\n`,
    );

    for (const action of result.actions) {
      process.stdout.write(
        `\n  Action #${String(action.actionId)} — ${action.actionName} (${action.actionType})\n`,
      );
      process.stdout.write(
        `    ${String(action.successful)} successful, ` +
        `${String(action.replied)} replied, ` +
        `${String(action.failed)} failed, ` +
        `${String(action.skipped)} skipped ` +
        `(${String(action.total)} total, ` +
        `${String(action.successRate)}% success rate)\n`,
      );

      if (action.firstResultAt) {
        process.stdout.write(
          `    Timeline: ${action.firstResultAt} — ${action.lastResultAt ?? action.firstResultAt}\n`,
        );
      }

      if (action.topErrors.length > 0) {
        process.stdout.write("    Top errors:\n");
        for (const err of action.topErrors) {
          const exceptionLabel = err.isException ? " (exception)" : "";
          process.stdout.write(
            `      Code ${String(err.code)}: ${String(err.count)}x — blame: ${err.whoToBlame}${exceptionLabel}\n`,
          );
        }
      }
    }
  }
}
