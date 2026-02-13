// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { DEFAULT_CDP_PORT, errorMessage, LauncherService } from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#account--instance | stop-instance} CLI command. */
export async function handleStopInstance(
  accountIdArg: string,
  options: { cdpPort?: number; cdpHost?: string; allowRemote?: boolean },
): Promise<void> {
  const accountId = Number(accountIdArg);
  const cdpPort = options.cdpPort ?? DEFAULT_CDP_PORT;
  const launcher = new LauncherService(cdpPort, {
    ...(options.cdpHost !== undefined && { host: options.cdpHost }),
    ...(options.allowRemote !== undefined && { allowRemote: options.allowRemote }),
  });

  try {
    await launcher.connect();
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    await launcher.stopInstance(accountId);
    process.stdout.write(
      `Instance stopped for account ${String(accountId)}\n`,
    );
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    launcher.disconnect();
  }
}
