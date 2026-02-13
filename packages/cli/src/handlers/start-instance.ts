// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  DEFAULT_CDP_PORT,
  errorMessage,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#account--instance | start-instance} CLI command. */
export async function handleStartInstance(
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
    const outcome = await startInstanceWithRecovery(
      launcher,
      accountId,
      cdpPort,
    );

    if (outcome.status === "timeout") {
      process.stderr.write(
        "Instance started but failed to initialize within timeout.\n",
      );
      process.exitCode = 1;
      return;
    }

    const verb =
      outcome.status === "already_running"
        ? "already running"
        : "started";

    process.stdout.write(
      `Instance ${verb} for account ${String(accountId)} on CDP port ${String(outcome.port)}\n`,
    );
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    launcher.disconnect();
  }
}
