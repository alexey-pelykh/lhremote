// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { AppService, DEFAULT_CDP_PORT, errorMessage } from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#app-management | quit-app} CLI command. */
export async function handleQuitApp(options: {
  cdpPort?: number;
}): Promise<void> {
  const app = new AppService(options.cdpPort ?? DEFAULT_CDP_PORT);

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
