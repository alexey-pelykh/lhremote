// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { errorMessage, scanOrphans, scanRunningInstances } from "@insoftex/lhremote-core";

/** Handle the list-orphans CLI command. */
export async function handleListOrphans(options: {
  json?: boolean;
}): Promise<void> {
  try {
    const liveInstances = await scanRunningInstances();
    const orphans = await scanOrphans(liveInstances);

    if (options.json) {
      process.stdout.write(JSON.stringify(orphans, null, 2) + "\n");
      return;
    }

    if (orphans.length === 0) {
      process.stdout.write("No orphaned processes detected.\n");
      return;
    }

    for (const o of orphans) {
      const account = o.accountId !== null ? `account ${String(o.accountId)}` : "unknown account";
      const port = o.cdpPort !== null ? `CDP port ${String(o.cdpPort)}` : "no CDP port";
      process.stdout.write(
        `PID ${String(o.pid)} — ${account} — ${port}\n  Reason: ${o.reason}\n`,
      );
    }
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
