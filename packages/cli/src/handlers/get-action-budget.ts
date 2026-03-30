// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  errorMessage,
  getActionBudget,
  type GetActionBudgetOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#get-action-budget | get-action-budget} CLI command. */
export async function handleGetActionBudget(
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: GetActionBudgetOutput;
  try {
    result = await getActionBudget({
      cdpPort: options.cdpPort,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(`Action Budget (as of ${result.asOf})\n\n`);

    const active = result.entries.filter(
      (e) => e.dailyLimit !== null || e.totalUsed > 0,
    );
    const inactive = result.entries.filter(
      (e) => e.dailyLimit === null && e.totalUsed === 0,
    );

    if (active.length > 0) {
      for (const entry of active) {
        const limitStr = entry.dailyLimit !== null
          ? String(entry.dailyLimit)
          : "unlimited";
        const remainStr = entry.remaining !== null
          ? String(entry.remaining)
          : "n/a";
        process.stdout.write(
          `  ${entry.limitType} (ID ${String(entry.limitTypeId)}): ` +
          `${String(entry.totalUsed)}/${limitStr} used ` +
          `(${String(entry.campaignUsed)} campaign, ${String(entry.directUsed)} direct), ` +
          `${remainStr} remaining\n`,
        );
      }
    }

    if (inactive.length > 0) {
      process.stdout.write(
        `\n  ${String(inactive.length)} other limit types with no activity today.\n`,
      );
    }
  }
}
