// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  DEFAULT_CDP_PORT,
  errorMessage,
  getThrottleStatus,
  type GetThrottleStatusOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#get-throttle-status | get-throttle-status} CLI command. */
export async function handleGetThrottleStatus(
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: GetThrottleStatusOutput;
  try {
    result = await getThrottleStatus({
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (result.throttled) {
      const sinceStr = result.since ?? "unknown";
      process.stdout.write(`THROTTLED since ${sinceStr}\n`);
    } else {
      process.stdout.write("Not throttled.\n");
    }
  }
}
