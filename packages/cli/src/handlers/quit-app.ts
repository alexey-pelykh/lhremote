// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { AppService, DEFAULT_CDP_PORT, errorMessage, resolveLauncherPort } from "@insoftex/lhremote-core";

/** Handle the {@link https://github.com/insoftex-company/insoftex-lhremote#app-management | quit-app} CLI command. */
export async function handleQuitApp(options?: { verbose?: boolean; cdpPort?: number }): Promise<void> {
  // Prefer the discovered launcher CDP port when available, fall back to default.
  let port = options?.cdpPort;
  try {
    if (port === undefined) {
      port = await resolveLauncherPort();
    }
  } catch {
    // If discovery fails, fall back to default port
  }

  const app = new AppService(port ?? DEFAULT_CDP_PORT);

  if (options?.verbose) {
    process.stdout.write(`Quitting LinkedHelper (CDP port ${String(port ?? DEFAULT_CDP_PORT)})\n`);
  }

  try {
    await app.quit();
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write("LinkedHelper quit\n");
}
