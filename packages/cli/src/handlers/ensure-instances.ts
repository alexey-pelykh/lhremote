// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  LauncherService,
  ensureInstances,
  errorMessage,
  resolveLauncherPort,
} from "@insoftex/lhremote-core";

/** Handle the ensure-instances CLI command. */
export async function handleEnsureInstances(
  accountIds: number[],
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  try {
    const port = await resolveLauncherPort(options.cdpPort, options.cdpHost);
    const launcherOptions: { host?: string; allowRemote?: boolean } = {};
    if (options.cdpHost !== undefined) launcherOptions.host = options.cdpHost;
    if (options.allowRemote !== undefined) launcherOptions.allowRemote = options.allowRemote;
    const launcher = new LauncherService(port, launcherOptions);

    try {
      await launcher.connect();
    } catch (error) {
      process.stderr.write(`Failed to connect to LinkedHelper: ${errorMessage(error)}\n`);
      process.exitCode = 1;
      return;
    }

    try {
      const results = await ensureInstances(accountIds, launcher, port);

      if (options.json) {
        process.stdout.write(JSON.stringify(results, null, 2) + "\n");
        return;
      }

      for (const r of results) {
        const parts = [`Account ${String(r.accountId)}: ${r.status}`];
        if (r.cdpPort !== undefined) parts.push(`CDP port ${String(r.cdpPort)}`);
        if (r.pid !== undefined) parts.push(`PID ${String(r.pid)}`);
        if (r.verified !== undefined) parts.push(r.verified ? "verified" : "NOT verified");
        if (r.error) parts.push(`error: ${r.error}`);
        process.stdout.write(parts.join(" — ") + "\n");
      }
    } finally {
      launcher.disconnect();
    }
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
