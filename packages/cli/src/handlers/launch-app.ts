// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { AppService, errorMessage, findApp } from "@insoftex/lhremote-core";

/** Handle the {@link https://github.com/insoftex-company/insoftex-lhremote#app-management | launch-app} CLI command. */
export async function handleLaunchApp(options?: { force?: boolean; verbose?: boolean; visible?: boolean }): Promise<void> {
  const onLog = options?.verbose
    ? (message: string) => { process.stderr.write(`[launch-app] ${message}\n`); }
    : undefined;

  const serviceOptions = {
    // Give LinkedHelper up to 10 seconds to start and become ready on the CDP port
    launchProbeDelay: 10000,
    ...(options?.force !== undefined && { force: options.force }),
    ...(onLog !== undefined && { onLog }),
    ...(options?.visible !== undefined && { visible: options.visible }),
  };
  const app = new AppService(undefined, serviceOptions);

  try {
    await app.launch();
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `LinkedHelper launched on CDP port ${String(app.cdpPort)}\n`,
  );

  if (options?.verbose) {
    try {
      const running = await findApp();
      if (running.length === 0) {
        process.stderr.write("[launch-app] No LinkedHelper processes found by process scanner\n");
      } else {
        for (const entry of running) {
          process.stderr.write(
            `[launch-app] Found process: pid=${String(entry.pid)} cdpPort=${String(entry.cdpPort)} role=${entry.role} connectable=${String(entry.connectable)}\n`,
          );
        }
      }
    } catch (err) {
      process.stderr.write(`[launch-app] Process scan failed: ${errorMessage(err)}\n`);
    }
  }
}
