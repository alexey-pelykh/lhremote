// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { getErrors, errorMessage, DEFAULT_CDP_PORT } from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#get-errors | get-errors} CLI command. */
export async function handleGetErrors(options: {
  cdpPort?: number;
  cdpHost?: string;
  allowRemote?: boolean;
  json?: boolean;
}): Promise<void> {
  try {
    const result = await getErrors({
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });

    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return;
    }

    // Overall health
    process.stdout.write(
      `Health: ${result.healthy ? "healthy" : "BLOCKED"}\n`,
    );
    process.stdout.write(
      `Account: ${String(result.accountId)}\n`,
    );

    // Instance issues
    if (result.issues.length === 0) {
      process.stdout.write("Issues: none\n");
    } else {
      process.stdout.write(`Issues: ${String(result.issues.length)}\n`);
      for (const issue of result.issues) {
        if (issue.type === "dialog") {
          const controls = issue.data.options.controls
            .map((c) => c.text)
            .join(", ");
          process.stdout.write(
            `  Dialog: ${issue.data.options.message} [${controls}]\n`,
          );
        } else {
          process.stdout.write(
            `  Critical error: ${issue.data.message}\n`,
          );
        }
      }
    }

    // Popup state
    if (result.popup === null || !result.popup.blocked) {
      process.stdout.write("Popup: none\n");
    } else {
      const closable = result.popup.closable ? "closable" : "unclosable";
      process.stdout.write(
        `Popup: ${result.popup.message ?? "blocking overlay"} (${closable})\n`,
      );
    }
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
