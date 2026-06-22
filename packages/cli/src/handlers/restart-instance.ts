// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  errorMessage,
  LauncherService,
  resolveAppPort,
  restartInstance,
} from "@insoftex/lhremote-core";

/** Handle the restart-instance CLI command. */
export async function handleRestartInstance(
  accountIdArg: string,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    force?: boolean;
    json?: boolean;
  },
): Promise<void> {
  const accountId = Number(accountIdArg);

  let cdpPort: number;
  try {
    cdpPort = options.cdpPort ?? await resolveAppPort("launcher");
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const launcher = new LauncherService(cdpPort, {
    ...(options.cdpHost !== undefined && { host: options.cdpHost }),
    ...(options.allowRemote !== undefined && { allowRemote: options.allowRemote }),
  });

  try {
    await launcher.connect();
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await restartInstance(launcher, accountId, cdpPort, {
      force: options.force ?? false,
    });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (!result.restarted) {
      process.stdout.write(
        `Instance for account ${String(accountId)} is already healthy ` +
          `(PID ${String(result.oldPid ?? "?")}, port ${String(result.cdpPort ?? "?")}). ` +
          `Use --force to restart anyway.\n`,
      );
      return;
    }

    const verifiedStr = result.verified ? "verified" : "unverified";
    process.stdout.write(
      `Instance restarted for account ${String(accountId)}: ` +
        `PID ${String(result.newPid ?? "?")} → port ${String(result.cdpPort ?? "?")} ` +
        `(${verifiedStr})` +
        (result.launcherRecovered ? " [launcher recovered]" : "") +
        "\n",
    );

    if (!result.verified) {
      process.stderr.write(
        "Warning: post-restart verification failed. " +
          "Check check-status to confirm the instance is running.\n",
      );
    }
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  } finally {
    launcher.disconnect();
  }
}
