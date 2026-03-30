// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { dismissErrors, errorMessage } from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#dismiss-errors | dismiss-errors} CLI command. */
export async function handleDismissErrors(options: {
  cdpPort?: number;
  cdpHost?: string;
  allowRemote?: boolean;
  json?: boolean;
}): Promise<void> {
  try {
    const result = await dismissErrors({
      cdpPort: options.cdpPort,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });

    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return;
    }

    process.stdout.write(
      `Account: ${String(result.accountId)}\n`,
    );
    process.stdout.write(
      `Dismissed: ${String(result.dismissed)}\n`,
    );

    if (result.nonDismissable > 0) {
      process.stdout.write(
        `Non-dismissable: ${String(result.nonDismissable)}\n`,
      );
    }
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
