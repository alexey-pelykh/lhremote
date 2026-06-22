// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { errorMessage, reapOrphans, scanOrphans, scanRunningInstances } from "@insoftex/lhremote-core";

/** Handle the reap-orphans CLI command. */
export async function handleReapOrphans(options: {
  confirm?: boolean;
  json?: boolean;
}): Promise<void> {
  try {
    const liveInstances = await scanRunningInstances();
    const orphans = await scanOrphans(liveInstances);

    if (orphans.length === 0) {
      process.stdout.write("No orphaned processes to reap.\n");
      return;
    }

    if (!options.confirm) {
      process.stdout.write(
        `Dry-run: would terminate ${String(orphans.length)} orphan(s):\n`,
      );
      for (const o of orphans) {
        process.stdout.write(
          `  PID ${String(o.pid)} — account ${String(o.accountId ?? "unknown")} — ${o.reason}\n`,
        );
      }
      process.stdout.write("Pass --confirm to actually terminate them.\n");
      return;
    }

    const results = await reapOrphans(orphans, true);

    if (options.json) {
      process.stdout.write(JSON.stringify(results, null, 2) + "\n");
      return;
    }

    for (const r of results) {
      const detail = r.reason ? ` (${r.reason})` : "";
      process.stdout.write(`PID ${String(r.pid)} — ${r.action}${detail}\n`);
    }
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
