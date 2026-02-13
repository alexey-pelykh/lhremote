// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  DEFAULT_CDP_PORT,
  errorMessage,
  resolveAccount,
  withDatabase,
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
  const cdpPort = options.cdpPort ?? DEFAULT_CDP_PORT;

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
      const statsOptions: { actionId?: number; maxErrors?: number } = {};
      if (options.actionId !== undefined) statsOptions.actionId = options.actionId;
      if (options.maxErrors !== undefined) statsOptions.maxErrors = options.maxErrors;
      const statistics = repo.getStatistics(campaignId, statsOptions);

      if (options.json) {
        process.stdout.write(JSON.stringify(statistics, null, 2) + "\n");
      } else {
        process.stdout.write(`Campaign #${String(campaignId)} Statistics\n`);
        process.stdout.write(
          `Totals: ${String(statistics.totals.successful)} successful, ` +
          `${String(statistics.totals.replied)} replied, ` +
          `${String(statistics.totals.failed)} failed, ` +
          `${String(statistics.totals.skipped)} skipped ` +
          `(${String(statistics.totals.total)} total, ` +
          `${String(statistics.totals.successRate)}% success rate)\n`,
        );

        for (const action of statistics.actions) {
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
  }
}
